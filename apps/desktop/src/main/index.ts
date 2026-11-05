import { AppError, LlmError, parseCheckItemDraft, parseCountryRuleDraft, type CheckItemDraft, type CheckStatus, type CountryRuleDraft } from "@lc/core";
import { AiService, extractCheckItems, getOcrLangs, importDocument, importManual, MAX_DOC_BYTES, migrateLegacyData, OCR_LANG_CHOICES, runCaseWithChecks, saveOcrLangs, UpdateService, type SecretBox } from "@lc/services";
import type { CaseStore } from "@lc/storage";
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell, type IpcMainInvokeEvent } from "electron";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { DocKind, Language, LcInvokeApi, MenuAction, PickedFile, ReportFormat, Result } from "../shared/api";
import { broadcast, buildMenu, DIALOG_TEXT, WINDOW_TITLE } from "./menu";
import { dataDirs, DataManager } from "./data";
import { OcrController } from "./ocr";
import { createPolicyReader } from "./policy";
import { exportReport } from "./report";
import { fakeLlm } from "./smoke";
import { createElectronUpdaterDriver } from "./updater";

/**
 * 冒烟自检：开发环境可直接用；打包后的应用必须显式设置 LC_ALLOW_SMOKE=1（避免正式版里留着绕过对话框的后门）。
 * 自检使用独立的临时数据目录，走与正式启动完全相同的路径（密钥保管、加密、备份）。
 */
const isSmoke = process.argv.includes("--smoke") && (!app.isPackaged || process.env.LC_ALLOW_SMOKE === "1");
const smokeDataDir = isSmoke ? mkdtempSync(join(tmpdir(), "lc-smoke-data-")) : null;
const smokeFixtureDir = process.env.LC_SMOKE_DIR ?? join(app.getAppPath(), "smoke");
/** 数据目录固定为 %APPDATA%\LCCompliance，不随产品名/包名变化；开发时可用 LC_DATA_DIR 覆盖 */
const dataRoot = smokeDataDir ?? (!app.isPackaged && process.env.LC_DATA_DIR ? process.env.LC_DATA_DIR : join(app.getPath("appData"), "LCCompliance"));
app.setPath("userData", dataRoot);

const MAX_LC_FILE_BYTES = 1024 * 1024;
/** 允许手工修正的单据文字上限，与外发上限同量级 */
const MAX_EDIT_CHARS = 200_000;

let store!: CaseStore;
let data!: DataManager;
let updates!: UpdateService;
const readPolicy = createPolicyReader({ allowOverride: !app.isPackaged || isSmoke, allowLocalHttp: !app.isPackaged || isSmoke });
let ai: AiService;
let ocr: OcrController;
/** 最近一次导出的报告路径；只允许「显示这个文件」，不接受渲染进程传入的任意路径 */
let lastExportPath: string | null = null;
let language: Language = "zh";

/** 用 Windows DPAPI（safeStorage）保护 API Key；不可用时拒绝保存而不是退化为明文 */
const secrets: SecretBox = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) throw new AppError("secret.unavailable", "系统加密不可用，无法安全保存 API Key", {});
    return safeStorage.encryptString(plain).toString("base64");
  },
  decrypt(enc) {
    return safeStorage.decryptString(Buffer.from(enc, "base64"));
  },
};

const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v === "") throw new AppError("ipc.invalidParam", `参数无效：${what}`, { what });
  return v;
};

const isLanguage = (v: unknown): v is Language => v === "zh" || v === "en";

/** 数据库打不开（锁定）时，只允许这些接口：查看状态、选语言、从备份恢复、退出 */
const LOCKED_OK = new Set<string>(["getStartupState", "getAppInfo", "quitApp", "getLanguage", "setLanguage", "inspectBackup", "commitRestore", "cancelRestore", "getPolicyInfo"]);

/** 所有处理器统一把异常转成 {ok:false}，避免 Electron 把内部错误栈泄漏给渲染进程 */
function handle<K extends keyof LcInvokeApi>(name: K, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(`lc:${name}`, async (e, ...args): Promise<Result<unknown>> => {
    if (data?.state.status === "locked" && !LOCKED_OK.has(name)) return { ok: false, error: "应用处于锁定状态，请先从备份恢复", code: "app.locked" };
    try {
      return { ok: true, data: (await fn(e, ...args)) ?? null };
    } catch (err) {
      if (isSmoke) console.log(`SMOKE_IPC_ERROR ${name}: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof AppError) return { ok: false, error: err.message, code: err.code, params: err.params };
      if (err instanceof LlmError) return { ok: false, error: err.message, code: `llm.${err.kind}`, params: { preview: err.preview ?? "" } };
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

async function pickLcFile(e: IpcMainInvokeEvent): Promise<PickedFile | null> {
  const d = DIALOG_TEXT[language];
  const win = BrowserWindow.fromWebContents(e.sender);
  const opts = {
    title: d.openLc,
    properties: ["openFile" as const],
    filters: [
      { name: d.swift, extensions: ["txt", "fin", "swi", "mt700", "out", "dat"] },
      { name: d.all, extensions: ["*"] },
    ],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const path = res.filePaths[0];
  if (res.canceled || !path) return null;

  const name = basename(path);
  if ((await stat(path)).size > MAX_LC_FILE_BYTES) throw new AppError("file.tooLarge", `文件过大：${name}`, { name });
  const buf = await readFile(path);
  if (buf.includes(0)) throw new AppError("file.notText", `不是文本文件：${name}`, { name });
  const text = buf.toString("utf8");
  // 去掉 UTF-8 BOM（U+FEFF）
  return { name, text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text };
}

/** 弹出文件选择框并读取单据；冒烟自检时可经环境变量跳过对话框 */
async function importDocFromDialog(e: IpcMainInvokeEvent, caseId: string, docType: DocKind) {
  const d = DIALOG_TEXT[language];
  const smokePath = isSmoke ? process.env.LC_SMOKE_FILE : undefined;
  let path = smokePath;
  if (!path) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: { invoice: d.openInvoice, transport: d.openTransport, insurance: d.openInsurance }[docType],
      properties: ["openFile" as const],
      filters: [
        { name: d.docs, extensions: ["pdf", "docx", "txt", "png", "jpg", "jpeg", "bmp"] },
        { name: d.all, extensions: ["*"] },
      ],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    path = res.canceled ? undefined : res.filePaths[0];
  }
  if (!path) return null;

  const fileName = basename(path);
  // 先看大小再读入，避免把超大文件整个读进内存
  if ((await stat(path)).size > MAX_DOC_BYTES) throw new AppError("doc.tooLarge", `文件过大：${fileName}`, { name: fileName, maxMb: MAX_DOC_BYTES / 1024 / 1024 });
  return importDocument(store, { caseId, docType, fileName, data: await readFile(path) }, ocr.runnerFor(fileName));
}

/** 渲染进程传来的检查项一律重新校验；失败时带上出错的字段，供界面定位 */
function validDraft(raw: unknown): CheckItemDraft {
  const r = parseCheckItemDraft(raw);
  if (!r.ok) throw new AppError("checkItem.invalid", `检查项内容无效：${r.error}`, { field: r.error });
  // 只有确定性的文字检查才可能是不符点
  if (r.draft.kind !== "text" && r.draft.severity === "discrepancy") throw new AppError("checkItem.invalid", "检查项内容无效：severity", { field: "severity" });
  return r.draft;
}

/** 国别规则同样重新校验，失败时带上出错的字段 */
function validCountryDraft(raw: unknown): CountryRuleDraft {
  const r = parseCountryRuleDraft(raw);
  if (!r.ok) throw new AppError("countryRule.invalid", `国别规则内容无效：${r.error}`, { field: r.error });
  return r.draft;
}

/** 弹出文件选择框上传手册；冒烟自检时可经环境变量跳过对话框 */
async function importManualFromDialog(e: IpcMainInvokeEvent) {
  const d = DIALOG_TEXT[language];
  let path = isSmoke ? process.env.LC_SMOKE_MANUAL : undefined;
  if (!path) {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = {
      title: d.openManual,
      properties: ["openFile" as const],
      filters: [
        { name: d.manuals, extensions: ["pdf", "docx", "txt", "png", "jpg", "jpeg", "bmp"] },
        { name: d.all, extensions: ["*"] },
      ],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    path = res.canceled ? undefined : res.filePaths[0];
  }
  if (!path) return null;
  const fileName = basename(path);
  if ((await stat(path)).size > MAX_DOC_BYTES) throw new AppError("doc.tooLarge", `文件过大：${fileName}`, { name: fileName, maxMb: MAX_DOC_BYTES / 1024 / 1024 });
  return importManual(store, { fileName, data: await readFile(path) }, ocr.runnerFor(fileName));
}

/** 口令只做类型与长度的基本检查（强度由 validatePassword 判断） */
function passwordParam(v: unknown): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 256) throw new AppError("ipc.invalidParam", "参数无效：password", { what: "password" });
  return v;
}

const isDocKind = (v: unknown): v is DocKind => v === "invoice" || v === "transport" || v === "insurance";

function applyLanguage(lang: Language, persist: boolean): void {
  language = lang;
  if (persist && store) store.setSetting("language", lang);
  Menu.setApplicationMenu(buildMenu(lang, (l) => applyLanguage(l, true), (a: MenuAction) => broadcast("lc:event:menu", a)));
  for (const w of BrowserWindow.getAllWindows()) w.setTitle(WINDOW_TITLE[lang]);
  broadcast("lc:event:language", lang);
}

function registerIpc(): void {
  handle("listCases", () => store.listCases());
  handle("createCase", (_e, i: { name?: unknown; lcText?: unknown }) =>
    store.createCase({ name: str(i?.name, "name"), lcText: str(i?.lcText, "lcText") }),
  );
  handle("getCase", (_e, id) => store.getCase(str(id, "id")));
  handle("savePresentation", (_e, id, p) => {
    if (!p || typeof p.presentationDate !== "string") throw new AppError("ipc.invalidParam", "参数无效：presentationDate", { what: "presentationDate" });
    store.savePresentation(str(id, "id"), p);
  });
  handle("runCase", (_e, id) => runCaseWithChecks(store, ai, str(id, "id")));
  handle("listRuns", (_e, id) => store.listRuns(str(id, "id")));
  handle("deleteCase", (_e, id) => store.deleteCase(str(id, "id")));
  handle("pickLcFile", (e) => pickLcFile(e));
  handle("importDocument", (e, caseId, docType) => {
    if (!isDocKind(docType)) throw new AppError("ipc.invalidParam", "参数无效：docType", { what: "docType" });
    return importDocFromDialog(e, str(caseId, "caseId"), docType);
  });
  handle("listDocuments", (_e, caseId) => store.listDocuments(str(caseId, "caseId")));
  handle("deleteDocument", (_e, id) => store.deleteDocument(str(id, "id")));
  handle("extractDocument", (_e, id) => ai.extract(str(id, "id")));
  handle("getDocumentText", (_e, id) => store.getDocumentText(str(id, "id")).text);
  handle("updateDocumentText", (_e, id, text) => {
    if (typeof text !== "string" || text.length > MAX_EDIT_CHARS) throw new AppError("ipc.invalidParam", "参数无效：text", { what: "text" });
    return store.updateDocumentText(str(id, "id"), text);
  });
  handle("getOcrSettings", () => ({ langs: getOcrLangs(store), choices: [...OCR_LANG_CHOICES] }));
  handle("saveOcrSettings", (_e, langs) => {
    saveOcrLangs(store, str(langs, "langs"));
    return { langs: getOcrLangs(store), choices: [...OCR_LANG_CHOICES] };
  });
  handle("cancelOcr", () => ocr.cancel());
  handle("exportReport", async (e, caseId, format) => {
    if (format !== "pdf" && format !== "docx") throw new AppError("ipc.invalidParam", "参数无效：format", { what: "format" });
    const r = await exportReport(store, {
      caseId: str(caseId, "caseId"),
      format: format as ReportFormat,
      lang: language,
      win: BrowserWindow.fromWebContents(e.sender),
      smokeDir: isSmoke ? process.env.LC_SMOKE_SAVE_DIR : undefined,
    });
    if (r) lastExportPath = r.path;
    return r;
  });
  handle("revealLastExport", () => {
    if (lastExportPath) shell.showItemInFolder(lastExportPath);
  });
  handle("importManual", (e) => importManualFromDialog(e));
  handle("listManuals", () => store.listManuals());
  handle("deleteManual", (_e, id) => store.deleteManual(str(id, "id")));
  handle("getManualText", (_e, id) => store.getManualText(str(id, "id")));
  handle("extractCheckItems", (_e, id) => extractCheckItems(store, ai, str(id, "id")));
  handle("listCheckItems", () => store.listCheckItems());
  handle("createCheckItem", (_e, draft) => store.addCheckItems([{ draft: validDraft(draft), source: null, origin: "user" }], "enabled")[0]);
  handle("updateCheckItem", (_e, id, draft) => store.updateCheckItem(str(id, "id"), validDraft(draft)));
  handle("setCheckItemsStatus", (_e, ids, status) => {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || !ids.every((x) => typeof x === "string")) throw new AppError("ipc.invalidParam", "参数无效：ids", { what: "ids" });
    if (status !== "candidate" && status !== "enabled" && status !== "disabled") throw new AppError("ipc.invalidParam", "参数无效：status", { what: "status" });
    store.setCheckItemStatus(ids, status as CheckStatus);
  });
  handle("deleteCheckItem", (_e, id) => store.deleteCheckItem(str(id, "id")));
  handle("listCountryRules", () => store.listCountryRules());
  handle("saveCountryRule", (_e, id, draft) => (id === null ? store.addCountryRule(validCountryDraft(draft)) : store.updateCountryRule(str(id, "id"), validCountryDraft(draft))));
  handle("deleteCountryRule", (_e, id) => store.deleteCountryRule(str(id, "id")));
  handle("getAiSettings", () => ai.getSettings());
  handle("saveAiSettings", (_e, input) => {
    if (!input || typeof input !== "object") throw new AppError("ipc.invalidParam", "参数无效：settings", { what: "settings" });
    // 只取白名单字段，防止渲染进程塞入其他键
    const { enabled, apiKey, model, redact, consent } = input;
    return ai.save({ enabled, apiKey, model, redact, consent });
  });
  handle("testAi", () => ai.test());
  handle("listAiModels", () => ai.listModels());
  handle("listLlmLog", () => store.listLlmLog(100));
  handle("getStartupState", () => data.state);
  handle("getAppInfo", () => ({ version: app.getVersion(), isPackaged: app.isPackaged }));
  handle("quitApp", () => app.quit());
  handle("getSecurityStatus", () => data.status());
  handle("verifyDatabase", () => data.verify());
  handle("createBackup", (_e, password) => data.createBackup(passwordParam(password)));
  handle("inspectBackup", (_e, password) => data.inspectBackup(passwordParam(password)));
  handle("commitRestore", () => {
    data.commitRestore();
    // 重启后用恢复的数据与密钥打开；自检时不重启，由自检代码直接校验结果
    if (!isSmoke) {
      app.relaunch();
      app.exit(0);
    }
  });
  handle("cancelRestore", () => data.cancelRestore());
  handle("setAutoBackup", (_e, input) => {
    if (!input || typeof input !== "object") throw new AppError("ipc.invalidParam", "参数无效：input", { what: "input" });
    return data.setAuto({ enabled: typeof input.enabled === "boolean" ? input.enabled : undefined, keep: typeof input.keep === "number" ? input.keep : undefined });
  });
  handle("runAutoBackupNow", () => data.runAutoNow());
  handle("revealBackupFolder", () => shell.openPath(data.status().backupDir).then(() => null));
  handle("getPolicyInfo", () => {
    const p = readPolicy();
    return { file: p.file, found: p.found, warnings: p.warnings, policy: p.policy };
  });
  handle("getUpdateState", () => updates.getState());
  handle("checkForUpdates", () => updates.check());
  handle("downloadUpdate", () => updates.download());
  handle("installUpdate", () => updates.install());
  handle("getLanguage", () => language);
  handle("setLanguage", (_e, lang) => {
    if (!isLanguage(lang)) throw new AppError("ipc.invalidParam", "参数无效：language", { what: "language" });
    applyLanguage(lang, true);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: WINDOW_TITLE[language],
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  // 禁止应用内跳转或新开窗口；外链交给系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"), isSmoke ? { query: { smoke: "1" } } : undefined);
  return win;
}

/** 切到中文并重新载入页面（让列表读到刚创建的案件） */
async function setLangAndReload(win: BrowserWindow): Promise<void> {
  applyLanguage("zh", false);
  const loaded = new Promise<void>((res) => win.webContents.once("did-finish-load", () => res()));
  win.webContents.reload();
  await loaded;
}

/** 需要人工查看界面时：LC_SMOKE_SHOT=目录 保存几张关键界面的截图 */
async function smokeScreenshots(win: BrowserWindow): Promise<void> {
  const dir = process.env.LC_SMOKE_SHOT;
  if (!dir) return;
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name: string) => {
    await wait(500);
    writeFileSync(join(dir, name), (await win.webContents.capturePage()).toPNG());
  };
  const click = (js: string) => win.webContents.executeJavaScript(js);
  win.setSize(1280, 800);
  await shot("1-kb-editor.png");
  // 关闭编辑框 → 检查项列表
  await click(`[...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "取 消" || b.textContent.trim() === "取消").pop().click()`);
  await shot("2-kb-items.png");
  // 手册页签
  await click(`[...document.querySelectorAll('[role="tab"]')].find((e) => /^手册/.test(e.textContent.trim())).click()`);
  await shot("3-kb-manuals.png");
  // 关闭知识库 → 案件结果页
  await click(`document.querySelector(".ant-modal-close").click()`);
  await shot("4-case-result.png");
}

/** 报告导出端到端：经 IPC 导出 PDF 与 Word，并读回 PDF 文字确认中文真的画出来了 */
async function smokeReport(win: BrowserWindow) {
  const dir = mkdtempSync(join(tmpdir(), "lc-smoke-report-"));
  process.env.LC_SMOKE_SAVE_DIR = dir;
  applyLanguage("zh", false);
  try {
    const exported = await win.webContents.executeJavaScript(`(async () => {
      const list = (await window.lc.listCases()).data;
      const c = list.find((x) => x.name === "rules");
      const out = {};
      for (const f of ["pdf", "docx"]) {
        const r = await window.lc.exportReport(c.id, f);
        out[f] = r.ok ? r.data : { error: r.error, code: r.code };
      }
      const bad = await window.lc.exportReport(c.id, "exe");
      out.badFormatRejected = bad.ok === false;
      return out;
    })()`);
    const result: Record<string, unknown> = { badFormatRejected: exported.badFormatRejected };
    if (exported.pdf?.path) {
      const bytes = await readFile(exported.pdf.path);
      const { extractPdfText } = await import("@lc/docs");
      const text = await extractPdfText(new Uint8Array(bytes));
      const flat = text.text.replace(/\s+/g, "");
      result.pdf = {
        fileName: exported.pdf.fileName,
        size: bytes.length,
        isPdf: bytes.subarray(0, 5).toString() === "%PDF-",
        pages: text.pages.length,
        hasTitle: flat.includes("信用证合规自查报告"),
        hasFinding: flat.includes("发票货物描述与信用证45A不相符"),
        hasActions: flat.includes("修改清单"),
        hasDisclaimer: flat.includes("免责声明"),
      };
    } else result.pdf = exported.pdf;
    if (exported.docx?.path) {
      const bytes = await readFile(exported.docx.path);
      result.docx = { fileName: exported.docx.fileName, size: bytes.length, isZip: bytes[0] === 0x50 && bytes[1] === 0x4b };
    } else result.docx = exported.docx;
    return result;
  } finally {
    // 需要人工查看导出文件时：LC_SMOKE_KEEP=1 保留临时目录并打印路径
    if (process.env.LC_SMOKE_KEEP) console.log("SMOKE_REPORT_DIR " + dir);
    else rmSync(dir, { recursive: true, force: true });
    delete process.env.LC_SMOKE_SAVE_DIR;
  }
}

/** 使用指南：首次启动自动弹出一次、首页快速上手、侧栏按钮、搜索、F1 菜单、英文版 */
async function smokeGuide(win: BrowserWindow): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const exec = (js: string) => win.webContents.executeJavaScript(js);
  const text = async () => (await exec("document.body.innerText")) as string;
  const shot = async (name: string) => {
    const d = process.env.LC_SMOKE_SHOT;
    if (!d) return;
    mkdirSync(d, { recursive: true });
    await sleep(500);
    writeFileSync(join(d, name), (await win.webContents.capturePage()).toPNG());
  };
  // 不带 ?smoke 重新载入，模拟用户真正的首次启动
  const loadFresh = async () => {
    const loaded = new Promise<void>((res) => win.webContents.once("did-finish-load", () => res()));
    void win.loadFile(join(__dirname, "../renderer/index.html"));
    await loaded;
    await sleep(1200);
  };
  const clickButton = (re: string) => exec(`[...document.querySelectorAll("button")].find((b) => /${re}/.test(b.textContent.replace(/\\s+/g, ""))).click()`);

  applyLanguage("zh", false);
  await exec(`localStorage.removeItem("lc.guide.seen")`);
  await loadFresh();
  const first = await text();
  out.firstRun = { drawerOpened: /欢迎使用/.test(first), hasQuickStartSection: /5 分钟快速上手/.test(first), hasToc: /名词小词典/.test(first), resolvedButtonNames: /点左上角「新建案件」/.test(first), noRawPlaceholders: !/\{\{/.test(first) };
  await shot("8-guide-first-run.png");

  await clickButton("开始使用");
  await sleep(700);
  const home = await text();
  out.home = { quickStartCard: /第一次使用？6 步上手/.test(home), stepsShown: /软件会自动做审证/.test(home) || /软件会自动做\s*审证/.test(home), openButton: /打开完整使用指南/.test(home), drawerClosed: !/欢迎使用/.test(home) };
  await shot("9-home-quickstart.png");

  await loadFresh();
  out.secondRunNoAutoOpen = !/欢迎使用/.test(await text());

  await clickButton("使用指南");
  await sleep(800);
  out.sidebarButton = /名词小词典/.test(await text());
  await exec(`(() => { const i = document.querySelector('.ant-drawer input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "备份"); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(600);
  const searched = await text();
  out.search = { showsSafety: /数据安全与备份/.test(searched), hidesUnrelated: !/名词小词典/.test(searched) };
  await shot("10-guide-search.png");

  await exec(`document.querySelector(".ant-drawer-close").click()`);
  await sleep(600);
  broadcast("lc:event:menu", "guide"); // 等同于按 F1 / 帮助菜单
  await sleep(800);
  out.menuOpensGuide = /名词小词典/.test(await text());
  await exec(`document.querySelector(".ant-drawer-close").click()`);
  await sleep(500);

  applyLanguage("en", false);
  await sleep(900);
  await clickButton("UserGuide");
  await sleep(800);
  const en = await text();
  out.english = { opens: /Quick start \(5 minutes\)/.test(en), glossary: /Glossary/.test(en), resolvedButtonNames: /Click “New Case” at the top left/.test(en) };
  await shot("11-guide-en.png");
  await exec(`document.querySelector(".ant-drawer-close").click()`);
  applyLanguage("zh", false);
  await sleep(600);
  return out;
}

/** 数据安全、备份恢复、策略与更新、锁定模式的端到端验证（真实 DPAPI、真实文件） */
async function smokeSecurity(win: BrowserWindow): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const exec = (js: string) => win.webContents.executeJavaScript(js);
  const dirs = dataDirs(dataRoot);
  const saveDir = mkdtempSync(join(tmpdir(), "lc-smoke-sec-"));
  process.env.LC_SMOKE_SAVE_DIR = saveDir;
  const raw = (f: string) => (existsSync(f) ? readFileSync(f) : Buffer.alloc(0));
  const MARKS = ["SMOKE-SECRET-CASE-9981", "SEC-REF-7741", "SMOKE-COUNTRY-NOTE-5523"];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** 需要人工查看界面时：LC_SMOKE_SHOT=目录 */
  const shot = async (name: string) => {
    const d = process.env.LC_SMOKE_SHOT;
    if (!d) return;
    mkdirSync(d, { recursive: true });
    await sleep(500);
    writeFileSync(join(d, name), (await win.webContents.capturePage()).toPNG());
  };
  applyLanguage("zh", false); // 前面的语言切换脚本最后停在英文，这里的界面检查按中文文字查找
  await sleep(800);
  const clickTab = (re: string) => exec(`[...document.querySelectorAll('[role="tab"]')].find((e) => /${re}/.test(e.textContent)).click()`);

  try {
    out.setup = await exec(`(async () => {
      const r = {};
      const c = await window.lc.createCase({ name: "SMOKE-SECRET-CASE-9981", lcText: ":20:SEC-REF-7741\\n:32B:USD1,00" });
      // 国别规则的备注同样以密文落盘（磁盘字节检查见下方）
      const cr = await window.lc.saveCountryRule(null, { countryCode: "QQ", level: "notice", requirements: [], note: "SMOKE-COUNTRY-NOTE-5523", enabled: true, reviewed: false });
      r.countryNoteSaved = cr.ok;
      const st = (await window.lc.getSecurityStatus()).data;
      r.encrypted = st.encrypted;
      r.autoEnabledByDefault = st.auto.enabled;
      r.keepDefault = st.auto.keep;
      r.verify = (await window.lc.verifyDatabase()).data;
      const weak = await window.lc.createBackup("short");
      r.weakRejected = weak.ok === false && weak.code === "backup.weakPassword";
      const bk = await window.lc.createBackup("correct horse battery");
      r.backup = bk.ok ? { name: bk.data.fileName, big: bk.data.bytes > 1000 } : bk.error;
      r.autoItems = (await window.lc.runAutoBackupNow()).data.auto.items.length;
      r.keep = (await window.lc.setAutoBackup({ keep: 3 })).data.auto.keep;
      const badKeep = await window.lc.setAutoBackup({ keep: 0 });
      r.badKeepRejected = badKeep.ok === false;
      return r;
    })()`);

    // 界面：设置 → 数据与备份
    await exec(`[...document.querySelectorAll("button")].find((b) => b.textContent.replace(/[^一-鿿]/g, "") === "设置").click()`);
    await sleep(600);
    await clickTab("数据与备份");
    await sleep(700);
    const dataText = (await exec("document.body.innerText")) as string;
    out.dataTabUi = { encrypted: /已加密/.test(dataText), hasExport: /导出加密备份/.test(dataText), hasAuto: /自动本地快照/.test(dataText), hasSnapshot: /auto-\d{8}-\d{6}\.db/.test(dataText) };
    await shot("5-settings-data.png");

    // 磁盘上的原始字节里不应有任何明文（数据库主文件、WAL、导出的备份、自动快照）
    const files = [dirs.db, dirs.db + "-wal", ...readdirSync(dirs.autoBackups).map((n) => join(dirs.autoBackups, n)), ...readdirSync(saveDir).map((n) => join(saveDir, n))];
    out.diskFilesChecked = files.length;
    out.plaintextOnDisk = files.filter((f) => MARKS.some((m) => raw(f).includes(Buffer.from(m))));
    out.keystoreHasRawKey = raw(dirs.keystore).toString("utf8").length > 0 && /"wrapped"/.test(raw(dirs.keystore).toString("utf8"));

    // 企业策略：AI 被禁用；更新源由策略提供；策略文件写坏时只给警告
    const policyFile = join(saveDir, "policy.json");
    process.env.LC_POLICY_FILE = policyFile;
    writeFileSync(policyFile, JSON.stringify({ update: { feedUrl: "http://localhost:1/lc/" }, ai: { allowed: false } }));
    out.policy = await exec(`(async () => {
      const r = {};
      const p = (await window.lc.getPolicyInfo()).data;
      r.found = p.found; r.aiAllowed = p.policy.ai.allowed; r.feedUrl = p.policy.update.feedUrl;
      const ai = (await window.lc.getAiSettings()).data;
      r.blockedByPolicy = ai.blockedByPolicy; r.enabledForcedOff = ai.enabled === false;
      const en = await window.lc.saveAiSettings({ enabled: true, consent: true });
      r.enableRejected = en.ok === false && en.code === "ai.blockedByPolicy";
      const probe = await window.lc.listAiModels();
      r.modelsBlocked = probe.ok === false && probe.code === "ai.blockedByPolicy";
      r.updateInitial = (await window.lc.getUpdateState()).data.status;
      const u1 = (await window.lc.checkForUpdates()).data;
      r.updateAvailable = [u1.status, u1.availableVersion];
      r.updateDownloaded = (await window.lc.downloadUpdate()).data.status;
      r.install = (await window.lc.installUpdate()).data;
      return r;
    })()`);
    await clickTab("更新");
    await sleep(700);
    const updText = (await exec("document.body.innerText")) as string;
    out.updateTabUi = { hasVersion: /当前版本/.test(updText), hasFeed: /更新源：http:\/\/localhost:1/.test(updText), hasPolicyFile: /策略文件/.test(updText), hasInstall: /重启并安装/.test(updText) };
    await shot("6-settings-update.png");
    await clickTab("AI 抽取");
    await sleep(500);
    out.aiTabLocked = /管理员策略禁止使用外部 AI/.test((await exec("document.body.innerText")) as string);
    await shot("6b-settings-ai-locked.png");
    await exec(`document.querySelector(".ant-modal-close").click()`);
    writeFileSync(policyFile, "{oops");
    out.badPolicy = await exec(`(async () => {
      const p = (await window.lc.getPolicyInfo()).data;
      const ai = (await window.lc.getAiSettings()).data;
      return { warnings: p.warnings.map((w) => w.code), aiAllowedDefault: p.policy.ai.allowed, blocked: ai.blockedByPolicy };
    })()`);
    rmSync(policyFile);
    delete process.env.LC_POLICY_FILE;

    // 从备份恢复：备份之后新建的案件应消失，当前数据保留为 pre-restore
    await exec(`window.lc.createCase({ name: "AFTER-BACKUP-CASE", lcText: ":20:AFTER\\n:32B:USD1,00" })`);
    process.env.LC_SMOKE_BACKUP = join(saveDir, readdirSync(saveDir).find((n) => n.endsWith(".lcbak"))!);
    out.restoreFlow = await exec(`(async () => {
      const r = {};
      const wrong = await window.lc.inspectBackup("wrong password");
      r.wrongPasswordRejected = wrong.ok === false && wrong.code === "backup.wrongPassword";
      const none = await window.lc.commitRestore();
      r.commitWithoutInspectRejected = none.ok === false && none.code === "backup.noPending";
      const prev = await window.lc.inspectBackup("correct horse battery");
      r.preview = prev.ok ? { cases: prev.data.caseCount, hasVersion: !!prev.data.appVersion } : prev.error;
      const done = await window.lc.commitRestore();
      r.committed = done.ok;
      return r;
    })()`);
    const re = data.open();
    store = data.store!;
    const names = store.listCases().map((c) => c.name);
    out.afterRestore = {
      reopened: data.state.status === "ok" && !re.migrated,
      hasBackedUpCase: names.includes("SMOKE-SECRET-CASE-9981"),
      afterBackupCaseGone: !names.includes("AFTER-BACKUP-CASE"),
      integrity: store.verifyIntegrity().ok,
      preRestoreKept: readdirSync(dirs.backups).filter((n) => n.startsWith("pre-restore-") || n.startsWith("keystore.pre-restore-")).length,
    };

    // 锁定模式：密钥文件丢失 → 只留恢复入口，业务接口被拒绝，数据原样不动
    data.close();
    renameSync(dirs.keystore, dirs.keystore + ".hidden");
    data.open();
    const reloaded = new Promise<void>((res) => win.webContents.once("did-finish-load", () => res()));
    win.webContents.reload();
    await reloaded;
    await sleep(900);
    const lockedText = (await exec("document.body.innerText")) as string;
    out.lockedUi = { showsRecovery: /无法解锁数据/.test(lockedText), reasonShown: /找不到数据密钥文件/.test(lockedText), hasRestore: /从备份恢复/.test(lockedText), hidesApp: !/新建案件/.test(lockedText) };
    await shot("7-locked.png");
    out.locked = await exec(`(async () => {
      const st = (await window.lc.getStartupState()).data;
      const list = await window.lc.listCases();
      const backup = await window.lc.createBackup("correct horse battery");
      const lang = await window.lc.getLanguage();
      return { status: st.status, reason: st.reason, listBlocked: list.ok === false && list.code === "app.locked", backupBlocked: backup.ok === false && backup.code === "app.locked", languageStillWorks: lang.ok };
    })()`);
    renameSync(dirs.keystore + ".hidden", dirs.keystore);
    data.open();
    store = data.store!;
    out.unlockedAgain = data.state.status === "ok" && store.listCases().length > 0;
  } finally {
    rmSync(saveDir, { recursive: true, force: true });
    delete process.env.LC_SMOKE_SAVE_DIR;
    delete process.env.LC_SMOKE_BACKUP;
  }
  return out;
}

/**
 * 更新端到端自检（LC_SMOKE_UPDATER_ONLY=1）：用真实的 electron-updater 对着本地更新服务器检查并下载，
 * 验证版本比较、latest.yml 解析、安装包下载与 sha512 校验。不执行安装。
 */
async function smokeUpdater(): Promise<void> {
  try {
    const events: string[] = [];
    updates.subscribe((st) => events.push(`${st.status}${st.status === "downloading" ? ":" + Math.floor(st.percent / 25) * 25 : ""}`));
    const before = updates.getState();
    const checked = await updates.check();
    const downloaded = checked.status === "available" ? await updates.download() : checked;
    console.log(
      "SMOKE_UPDATER " +
        JSON.stringify({
          currentVersion: before.currentVersion,
          initial: before.status,
          feedUrl: before.feedUrl,
          afterCheck: [checked.status, checked.availableVersion, checked.error],
          afterDownload: [downloaded.status, downloaded.percent, downloaded.error],
          progressSeen: [...new Set(events)],
        }),
    );
    app.exit(0);
  } catch (e) {
    console.log("SMOKE_UPDATER_FAIL " + (e instanceof Error ? e.message : String(e)));
    app.exit(1);
  }
}

/** 冒烟自检：经真实的 preload→IPC→存储 链路走一遍业务流程并确认界面已渲染，输出 JSON 后退出 */
async function smoke(win: BrowserWindow): Promise<void> {
  const menuLabels = () => Menu.getApplicationMenu()?.items.map((i) => i.label);
  const script = (lang: string) => `(async () => {
    const r = {};
    r.hasBridge = typeof window.lc?.createCase === "function" && typeof window.lc?.pickLcFile === "function";
    r.noNodeLeak = typeof window.require === "undefined" && typeof window.process === "undefined";
    const bad = await window.lc.createCase({ name: "bad", lcText: ":20:X" });
    r.badRejected = bad.ok === false && bad.code === "mt700.field32B";
    const c = await window.lc.createCase({ name: "smoke", lcText: ":20:SMK\\n:32B:USD1000,00\\n:44C:240820" });
    const id = c.data.id;
    await window.lc.savePresentation(id, { presentationDate: "2024-09-30", transport: { shipmentDate: "2024-08-21" } });
    const run = await window.lc.runCase(id);
    r.findings = run.data.findings.map(f => f.code);
    await window.lc.deleteCase(id);
    await window.lc.setLanguage(${JSON.stringify(lang)});
    await new Promise(res => setTimeout(res, 600));
    r.lang = (await window.lc.getLanguage()).data;
    r.rendered = (document.getElementById("root")?.children.length ?? 0) > 0;
    r.title = document.title;
    r.newCaseButton = [...document.querySelectorAll("button")].map(b => b.textContent.trim()).find(t => /新建案件|New Case/.test(t));
    return r;
  })()`;
  // 规则库端到端：一份带多种问题的合成信用证与单据（非真实数据）
  const rulesLc = [
    ":20:RULE1", ":40A:IRREVOCABLE", ":31D:241030SHANGHAI", ":32B:USD100000,00", ":44C:241020",
    ":44E:SHANGHAI, CHINA", ":44F:NEW YORK", ":50:ACME IMPORTS INC", ":59:SANDNES TRADING CO LTD",
    ":45A:1000 SETS OF WIDGETS MODEL X", "CIF NEW YORK",
    ":47A:+INSPECTION CERTIFICATE SIGNED BY THE APPLICANT", ":48:21 DAYS",
  ].join("\n");
  const rulesPresentation = {
    presentationDate: "2024-10-25",
    invoice: { currency: "USD", amount: 100000, sellerName: "OTHER LTD", buyerName: "ACME IMPORTS INC", goodsDescription: "1000 SETS OF WIDGETS MODEL Y CIF NEW YORK" },
    transport: { shipmentDate: "2024-10-10", portOfLoading: "NINGBO", portOfDischarge: "NEW YORK" },
    insurance: { currency: "USD", amount: 100000, date: "2024-10-12" },
  };
  const rulesScript = `(async () => {
    const r = {};
    const c = await window.lc.createCase({ name: "rules", lcText: ${JSON.stringify(rulesLc)} });
    const id = c.data.id;
    const lcOnly = await window.lc.runCase(id);
    r.lcOnly = { codes: lcOnly.data.findings.map(f => f.code), checked: lcOnly.data.coverage.checked.length, skipped: lcOnly.data.coverage.skipped.length };
    await window.lc.savePresentation(id, ${JSON.stringify(rulesPresentation)});
    const full = await window.lc.runCase(id);
    r.full = { codes: full.data.findings.map(f => f.code).sort(), checked: full.data.coverage.checked.length, skipped: full.data.coverage.skipped.length, errors: full.data.errors.length };
    return r;
  })()`;
  // 重新载入页面，点开该案件的「审查结果」，确认界面真的渲染出结果
  const uiScript = `(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    await wait(800);
    const item = [...document.querySelectorAll(".ant-list-item")].find((e) => e.textContent.includes("rules"));
    item.click();
    await wait(600);
    const tab = [...document.querySelectorAll('[role="tab"]')].find((e) => /审查结果|Check Result/.test(e.textContent));
    tab.click();
    await wait(600);
    const text = document.body.innerText;
    return { hasSections: /审证：信用证本身/.test(text) && /审单：拟交单据/.test(text), hasChecklist: /检查清单/.test(text), hasSoftClause: /疑似软条款/.test(text), hasGoodsFinding: /货物描述与信用证 45A 不相符/.test(text) };
  })()`;
  // 扫描件 OCR 端到端：真实的 tesseract 引擎 + 真实的 PDF 页面渲染，经 IPC 走完导入、取词、修正文字
  const ocrScript = `(async () => {
    const r = {};
    const events = [];
    const off = window.lc.onOcrProgress((e) => events.push(e));
    const c = await window.lc.createCase({ name: "ocr", lcText: ":20:OCR1\\n:32B:USD100000,00" });
    const id = c.data.id;
    const imp = await window.lc.importDocument(id, "invoice");
    off();
    r.imported = { ok: imp.ok, error: imp.ok ? null : imp.error, sourceKind: imp.data?.sourceKind, needsOcr: imp.data?.needsOcr, confidence: imp.data?.ocrConfidence, chars: imp.data?.chars };
    r.progressEvents = events.length;
    r.lastEvent = events.length ? events[events.length - 1] : null;
    const docId = imp.data.id;
    const txt = (await window.lc.getDocumentText(docId)).data;
    r.recognizedAmount = txt.replace(/\\s+/g, "").includes("98,500.50");
    const ex = await window.lc.extractDocument(docId);
    r.extractedFields = ex.ok ? Object.keys(ex.data.fields) : ex.error;
    const upd = await window.lc.updateDocumentText(docId, txt + "\\n(checked by user)");
    r.extractionClearedAfterEdit = upd.ok && upd.data.extraction === null;
    r.langs = (await window.lc.getOcrSettings()).data.langs;
    const bad = await window.lc.saveOcrSettings("../x");
    r.badLangRejected = bad.ok === false && bad.code === "ocr.langUnsupported";
    await window.lc.deleteCase(id);
    return r;
  })()`;
  // 手册知识库端到端：上传 → 提炼候选 → 校验 → 启用 → 对案件审查（文字类 / 人工类 / AI 判断类）
  const kbSetupScript = `(async () => {
    const r = {};
    const imp = await window.lc.importManual();
    r.manual = { ok: imp.ok, name: imp.data?.name, kind: imp.data?.sourceKind };
    const ex = await window.lc.extractCheckItems(imp.data.id);
    r.extracted = ex.ok ? { created: ex.data.created.map((i) => [i.title, i.kind, i.scope, i.severity, i.status]), dropped: ex.data.dropped.length } : { error: ex.error, code: ex.code };
    const bad1 = await window.lc.createCheckItem({ title: "", requirement: "x", kind: "manual", scope: "invoice", severity: "info" });
    r.emptyTitleRejected = bad1.ok === false && bad1.code === "checkItem.invalid" && bad1.params.field === "title";
    const bad2 = await window.lc.createCheckItem({ title: "t", requirement: "x", kind: "ai", scope: "invoice", severity: "discrepancy" });
    r.aiDiscrepancyRejected = bad2.ok === false && bad2.params.field === "severity";
    const items = (await window.lc.listCheckItems()).data;
    await window.lc.setCheckItemsStatus(items.map((i) => i.id), "enabled");
    const c = await window.lc.createCase({ name: "kb", lcText: ${JSON.stringify(":20:KB1\n:32B:USD100000,00")} });
    r.caseId = c.data.id;
    return r;
  })()`;
  const kbImportScript = (caseId: string, docType: string) => `(async () => (await window.lc.importDocument(${JSON.stringify(caseId)}, ${JSON.stringify(docType)})).ok)()`;
  const kbRunScript = (caseId: string) => `(async () => {
    const run = (await window.lc.runCase(${JSON.stringify(caseId)})).data;
    const custom = run.findings.filter((f) => f.ruleId.startsWith("CUSTOM-"));
    return {
      codes: custom.map((f) => f.code).sort(),
      severities: Object.fromEntries(custom.map((f) => [f.code, f.severity])),
      hasManualEvidence: custom.every((f) => f.evidence.some((e) => e.document === "manual") || f.code === "custom.manual" ? true : false),
      titles: Object.values(run.customTitles).sort(),
      checkedCustom: run.coverage.checked.filter((id) => id.startsWith("CUSTOM-")).length,
      skippedCustom: run.coverage.skipped.filter((id) => id.startsWith("CUSTOM-")).length,
    };
  })()`;
  const kbUiScript = `(async () => {
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const item = [...document.querySelectorAll(".ant-list-item")].find((e) => e.textContent.includes("kb"));
    item.click();
    await wait(600);
    [...document.querySelectorAll('[role="tab"]')].find((e) => /审查结果|Check Result/.test(e.textContent)).click();
    await wait(600);
    const text = document.body.innerText;
    const out = { hasTextFinding: /不满足检查项「提单须注明运费预付」/.test(text), hasManualSource: /手册依据/.test(text), hasManualReminder: /人工核对：发运前电话确认买方/.test(text), hasAiFinding: /AI 认为/.test(text), hasCustomInChecklist: /发票货描无矛盾/.test(text) };

    // 知识库弹窗：手册列表、检查项列表、编辑框
    [...document.querySelectorAll("button")].find((b) => /审单知识库/.test(b.textContent)).click();
    await wait(700);
    const modal1 = document.body.innerText;
    out.kbShowsManual = /manual/.test(modal1) && /手册/.test(modal1) && /待审核 0 · 已启用 3 · 已停用 0/.test(modal1);
    [...document.querySelectorAll('[role="tab"]')].find((e) => /^检查项/.test(e.textContent.trim())).click();
    await wait(600);
    const modal2 = document.body.innerText;
    out.kbShowsItems = /提单须注明运费预付/.test(modal2) && /FREIGHT PREPAID/.test(modal2) && /文字检查/.test(modal2) && /AI 判断/.test(modal2) && /人工核对/.test(modal2);
    [...document.querySelectorAll("button")].find((b) => /新建检查项/.test(b.textContent)).click();
    await wait(600);
    const modal3 = document.body.innerText;
    out.kbEditorOpens = /检查方式/.test(modal3) && /关键词/.test(modal3) && /匹配方式/.test(modal3);
    return out;
  })()`;
  // 国别规则与船东单端到端：52A 国家命中、规则保存校验、货代签发的提单被列为疑点（均为合成数据）
  const countryLc = [
    ":20:CTRY1", ":40A:IRREVOCABLE", ":31D:241030SHANGHAI", ":32B:USD100000,00", ":44C:241020",
    ":52A:TESTBDDHXXX", ":59:SANDNES TRADING CO LTD", ":45A:1000 SETS OF WIDGETS MODEL X",
    ":47A:+B/L MUST BE ISSUED BY THE CARRIER",
  ].join("\n");
  const countryScript = `(async () => {
    const r = {};
    const c = await window.lc.createCase({ name: "country", lcText: ${JSON.stringify(countryLc)} });
    const id = c.data.id;
    const lcOnly = await window.lc.runCase(id);
    const hit = lcOnly.data.findings.find((f) => f.code === "country.hit");
    r.countryHit = { found: !!hit, ruleId: hit?.ruleId ?? null };
    const draft = { countryCode: "zz", level: "notice", requirements: [], note: "synthetic", enabled: true, reviewed: false };
    const okSave = await window.lc.saveCountryRule(null, draft);
    r.savedCode = okSave.ok ? okSave.data.countryCode : okSave.error;
    const bad = await window.lc.saveCountryRule(null, { ...draft, countryCode: "ZZZ" });
    r.badCodeRejected = bad.ok === false && bad.code === "countryRule.invalid";
    if (okSave.ok) await window.lc.deleteCountryRule(okSave.data.id);
    await window.lc.savePresentation(id, { presentationDate: "2024-10-25", transport: { shipmentDate: "2024-10-10", signingCapacity: "freight forwarder" } });
    const full = await window.lc.runCase(id);
    r.forwarderFlagged = full.data.findings.some((f) => f.code === "carrierBl.forwarder");
    await window.lc.deleteCase(id);
    return r;
  })()`;
  const docScript = `(async () => {
    const r = {};
    const c = await window.lc.createCase({ name: "docs", lcText: ":20:D1\\n:32B:USD100000,00" });
    const id = c.data.id;
    const imp = await window.lc.importDocument(id, "invoice");
    r.imported = { ok: imp.ok, kind: imp.data?.sourceKind, needsOcr: imp.data?.needsOcr, chars: imp.data?.chars };
    const docId = imp.data.id;
    const off = await window.lc.extractDocument(docId);
    r.blockedWhenDisabled = off.ok === false && off.code === "ai.disabled";
    const noConsent = await window.lc.saveAiSettings({ enabled: true });
    r.consentRequired = noConsent.ok === false && noConsent.code === "ai.consentRequired";
    const saved = await window.lc.saveAiSettings({ enabled: true, consent: true, apiKey: "sk-smoke-secret" });
    r.settings = saved.data;
    const ex = await window.lc.extractDocument(docId);
    r.fields = ex.ok ? Object.fromEntries(Object.entries(ex.data.fields).map(([k, v]) => [k, v.value])) : ex;
    r.rejected = ex.ok ? ex.data.rejected : null;
    r.persisted = !!(await window.lc.listDocuments(id)).data[0].extraction;
    const log = (await window.lc.listLlmLog()).data;
    const logText = JSON.stringify(log);
    r.logCount = log.length;
    r.accountRedactedInLog = !logText.includes("6222020200112233445");
    r.keyLeaked = logText.includes("sk-smoke-secret") || JSON.stringify(saved).includes("sk-smoke-secret");
    await window.lc.deleteCase(id);
    return r;
  })()`;
  try {
    process.env.LC_SMOKE_FILE = join(smokeFixtureDir, "invoice.pdf");
    await new Promise<void>((res) => win.webContents.once("did-finish-load", () => res()));
    const docs = await win.webContents.executeJavaScript(docScript);
    process.env.LC_SMOKE_FILE = join(smokeFixtureDir, "scan.pdf");
    const ocrResult = await win.webContents.executeJavaScript(ocrScript);
    const rules = await win.webContents.executeJavaScript(rulesScript);
    // 手册知识库：依次切换要导入的文件
    process.env.LC_SMOKE_MANUAL = join(smokeFixtureDir, "manual.txt");
    const kb = await win.webContents.executeJavaScript(kbSetupScript);
    process.env.LC_SMOKE_FILE = join(smokeFixtureDir, "bl.txt");
    kb.importedTransport = await win.webContents.executeJavaScript(kbImportScript(kb.caseId, "transport"));
    process.env.LC_SMOKE_FILE = join(smokeFixtureDir, "invoice.pdf");
    kb.importedInvoice = await win.webContents.executeJavaScript(kbImportScript(kb.caseId, "invoice"));
    kb.run = await win.webContents.executeJavaScript(kbRunScript(kb.caseId));
    const country = await win.webContents.executeJavaScript(countryScript);
    const report = await smokeReport(win);
    await setLangAndReload(win);
    const ui = await win.webContents.executeJavaScript(uiScript);
    const kbUi = await win.webContents.executeJavaScript(kbUiScript);
    await smokeScreenshots(win);
    const zh = await win.webContents.executeJavaScript(script("zh"));
    const zhMenu = menuLabels();
    const en = await win.webContents.executeJavaScript(script("en"));
    const enMenu = menuLabels();
    // 安全阶段放在最后：其中的「恢复」会替换整个数据库，之后不再有其他阶段依赖旧连接
    const guide = await smokeGuide(win);
    const security = await smokeSecurity(win);
    console.log("SMOKE_RESULT " + JSON.stringify({ guide, security, kb, kbUi, country, ocr: ocrResult, report, rules, ui, docs, zh, zhMenu, en, enMenu }));
    app.exit(0);
  } catch (e) {
    console.log("SMOKE_FAIL " + (e instanceof Error ? e.message : String(e)));
    app.exit(1);
  }
}

/** 致命错误：提示后退出（如系统加密不可用——此时绝不退化为明文存储） */
function fatal(title: string, detail: string): never {
  dialog.showErrorBox(title, detail);
  app.exit(1);
  throw new Error(detail);
}

// 同一个数据目录只允许一个实例，避免两个进程同时写同一个数据库
if (!isSmoke && !app.requestSingleInstanceLock()) app.exit(0);

app.whenReady().then(async () => {
  language = app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en";
  const dirs = dataDirs(dataRoot);

  // 升级：旧版本把数据放在 %APPDATA%\@lc\desktop。移动（而非复制）过来，旧位置不会留下明文数据库
  if (!isSmoke) migrateLegacyData(join(app.getPath("appData"), "@lc", "desktop"), dirs.root);

  data = new DataManager({
    dirs,
    box: secrets,
    appVersion: app.getVersion(),
    pickSave: async (name) => {
      if (isSmoke && process.env.LC_SMOKE_SAVE_DIR) return join(process.env.LC_SMOKE_SAVE_DIR, name);
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: language === "zh" ? "导出加密备份" : "Export encrypted backup", defaultPath: join(app.getPath("documents"), name), filters: [{ name: "L/C backup", extensions: ["lcbak"] }] };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    pickOpen: async () => {
      if (isSmoke && process.env.LC_SMOKE_BACKUP) return process.env.LC_SMOKE_BACKUP;
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: language === "zh" ? "选择备份文件" : "Select a backup file", properties: ["openFile" as const], filters: [{ name: "L/C backup", extensions: ["lcbak"] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
  });

  try {
    const opened = data.open();
    if (opened.migrated) console.log("DB_MIGRATED_TO_ENCRYPTED");
  } catch (e) {
    fatal(language === "zh" ? "无法打开数据库" : "Cannot open the database", e instanceof Error ? e.message : String(e));
  }

  if (data.store) {
    store = data.store;
    const saved = store.getSetting("language");
    if (isLanguage(saved)) language = saved;
  }

  ai = new AiService(
    store,
    secrets,
    // 冒烟自检使用不联网的假模型，其余情况使用真实 DeepSeek 客户端
    isSmoke
      ? (o) => ({
          completeJson: async (messages) => {
            const out = await fakeLlm.completeJson(messages);
            o.onCall?.({ at: new Date().toISOString(), provider: "fake", model: o.model ?? "fake", messages, attempt: 0, outcome: "ok" });
            return out;
          },
        })
      : undefined,
    () => readPolicy().policy.ai.allowed, // 管理员策略可以禁止使用外部 AI
  );
  ocr = new OcrController({
    getLangs: () => (store ? getOcrLangs(store) : "eng"),
    langDir: join(dirs.root, "ocr-lang"),
    anchorDir: app.getAppPath(),
    emit: (e) => broadcast("lc:event:ocr", e),
  });

  // 自检用假更新驱动（不联网、不安装）；正式运行使用 electron-updater
  const fakeUpdater = {
    configure: () => undefined,
    check: async () => ({ version: "99.0.0" }),
    download: async (onProgress: (p: number) => void) => {
      onProgress(40);
      onProgress(100);
    },
    quitAndInstall: () => undefined,
  };
  updates = new UpdateService({
    driver: isSmoke && !process.env.LC_SMOKE_REAL_UPDATER ? fakeUpdater : createElectronUpdaterDriver(),
    policy: () => readPolicy().policy,
    currentVersion: app.getVersion(),
    isPackaged: app.isPackaged || isSmoke,
  });
  updates.subscribe((st) => broadcast("lc:event:update", st));

  registerIpc();
  applyLanguage(language, false);
  const win = createWindow();
  app.on("second-instance", () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  if (isSmoke) void (process.env.LC_SMOKE_UPDATER_ONLY ? smokeUpdater() : smoke(win));
  else {
    // 自动本地快照与检查更新：启动后稍等再做，不拖慢打开速度
    const HOURS_6 = 6 * 3600_000;
    setTimeout(() => void safely(() => data.maybeAuto()), 20_000);
    setInterval(() => void safely(() => data.maybeAuto()), HOURS_6);
    setTimeout(() => updates.autoCheck && void updates.check(), 15_000);
    setInterval(() => updates.autoCheck && void updates.check(), HOURS_6);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/** 后台任务出错不应影响应用运行 */
async function safely(fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch {
    /* 下次再试 */
  }
}

app.on("window-all-closed", () => {
  data?.close();
  if (smokeDataDir) rmSync(smokeDataDir, { recursive: true, force: true });
  app.quit();
});
