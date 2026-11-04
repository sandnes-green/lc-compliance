import { AppError, formatLocalTime } from "@lc/core";
import { buildReport, renderReportDocx, renderReportHtml, reportFileName } from "@lc/services";
import type { CaseStore } from "@lc/storage";
import { app, BrowserWindow, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Language, ReportFormat } from "../shared/api";

const FOOTER = `<div style="font-size:8px;color:#8c8c8c;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

/**
 * 把 HTML 打印成 PDF。使用一个不显示、禁用脚本、沙箱化的窗口，
 * 内容经临时文件加载（避免 data: URL 的长度限制），用完即删。
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const file = join(app.getPath("temp"), `lc-report-${randomUUID()}.html`);
  await writeFile(file, html, "utf8");
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true },
  });
  try {
    await win.loadFile(file);
    return await win.webContents.printToPDF({
      preferCSSPageSize: true, // 页边距由报告 CSS 的 @page 控制
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER,
    });
  } catch (e) {
    throw new AppError("report.pdfFailed", `生成 PDF 失败：${e instanceof Error ? e.message : String(e)}`, { detail: e instanceof Error ? e.message : String(e) });
  } finally {
    win.destroy();
    await unlink(file).catch(() => undefined);
  }
}

export interface ExportResult {
  path: string;
  fileName: string;
}

/** 弹出「另存为」对话框；冒烟自检时可经环境变量指定目录以跳过对话框。用户取消返回 null */
async function chooseTarget(win: BrowserWindow | null, defaultName: string, format: ReportFormat, lang: Language, smokeDir?: string): Promise<string | null> {
  if (smokeDir) return join(smokeDir, defaultName);
  const opts = {
    title: lang === "zh" ? "导出审单报告" : "Export report",
    defaultPath: join(app.getPath("documents"), defaultName),
    filters: [format === "pdf" ? { name: "PDF", extensions: ["pdf"] } : { name: "Word", extensions: ["docx"] }],
  };
  const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  return res.canceled || !res.filePath ? null : res.filePath;
}

/** 导出某案件最近一次审查的报告。先选保存位置（取消则不做任何计算），再生成并写盘 */
export async function exportReport(
  store: CaseStore,
  args: { caseId: string; format: ReportFormat; lang: Language; win: BrowserWindow | null; smokeDir?: string },
): Promise<ExportResult | null> {
  const { caseId, format, lang } = args;
  const c = store.getCase(caseId);
  if (!c) throw new AppError("case.notFound", `案件不存在：${caseId}`, { id: caseId });
  const run = store.listRuns(caseId)[0];
  if (!run) throw new AppError("report.noRun", "尚未审查，无法导出报告", {});

  const now = new Date().toISOString();
  const fileName = reportFileName(c.name, lang, formatLocalTime(now), format); // 文件名用本地日期
  const path = await chooseTarget(args.win, fileName, format, lang, args.smokeDir);
  if (!path) return null;

  const report = buildReport({ caseName: c.name, lc: c.lc, run, generatedAt: now, lang });
  const bytes = format === "pdf" ? await htmlToPdf(renderReportHtml(report)) : await renderReportDocx(report);

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  } catch (e) {
    throw new AppError("report.writeFailed", `保存失败：${e instanceof Error ? e.message : String(e)}`, { detail: e instanceof Error ? e.message : String(e) });
  }
  store.logEvent("report.export", { runId: run.id, format, lang }, caseId); // 审计只记录动作，不记录路径与内容
  return { path, fileName: path.split(/[\\/]/).pop() ?? fileName };
}
