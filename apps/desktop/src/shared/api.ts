import type { CheckItem, CheckItemDraft, CheckStatus, CountryRule, CountryRuleDraft, ExtractionResult, Lang, Presentation } from "@lc/core";
import type { AiSettings, AiSettingsInput, ExtractCheckItemsResult, LockReason, Policy, PolicyWarning, UpdateState } from "@lc/services";
import type { CaseRecord, CaseSummary, DocKind, DocumentRecord, LlmLogEntry, ManualRecord, RunRecord } from "@lc/storage";

export type { LockReason, Policy, PolicyWarning, UpdateState, AiSettings, AiSettingsInput, CheckItem, CheckItemDraft, CheckStatus, CountryRule, CountryRuleDraft, ExtractCheckItemsResult, ManualRecord, CaseRecord, CaseSummary, DocKind, DocumentRecord, ExtractionResult, LlmLogEntry, Presentation, RunRecord };
export type Language = Lang;

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; params?: Record<string, string | number> };

export interface PickedFile {
  name: string;
  text: string;
}

export type MenuAction = "newCase" | "guide";

export type ReportFormat = "pdf" | "docx";

/** 启动状态：数据库打不开（密钥读不出、缺失或不匹配）时为 locked，界面只提供「从备份恢复」 */
export type StartupState = { status: "ok" } | { status: "locked"; reason: LockReason; message: string };

export interface AutoBackupItem {
  name: string;
  bytes: number;
  at: string;
}

export interface SecurityStatus {
  encrypted: boolean;
  dataDir: string;
  backupDir: string;
  /** 最近一次口令加密备份的时间；从未备份为 null */
  lastBackupAt: string | null;
  auto: { enabled: boolean; keep: number; items: AutoBackupItem[] };
}

export interface BackupResult {
  fileName: string;
  bytes: number;
}

export interface RestorePreview {
  fileName: string;
  createdAt: string;
  appVersion: string;
  caseCount: number;
}

export interface PolicyInfo {
  /** 策略文件路径与是否存在 */
  file: string;
  found: boolean;
  warnings: PolicyWarning[];
  policy: Policy;
}

export interface AppInfo {
  version: string;
  isPackaged: boolean;
}

export interface ExportedReport {
  path: string;
  fileName: string;
}

export interface OcrSettingsInfo {
  langs: string;
  choices: string[];
}

export interface OcrProgressEvent {
  fileName: string;
  page: number;
  pages: number;
  percent: number;
}

/** 渲染进程可调用的请求/响应型能力；每个方法一一对应一个 IPC 通道 */
export interface LcInvokeApi {
  listCases(): Promise<Result<CaseSummary[]>>;
  createCase(input: { name: string; lcText: string }): Promise<Result<CaseRecord>>;
  getCase(id: string): Promise<Result<CaseRecord | null>>;
  savePresentation(id: string, presentation: Presentation): Promise<Result<null>>;
  runCase(id: string): Promise<Result<RunRecord>>;
  listRuns(id: string): Promise<Result<RunRecord[]>>;
  deleteCase(id: string): Promise<Result<null>>;
  /** 弹出系统文件选择框读取信用证报文；用户取消时返回 null */
  pickLcFile(): Promise<Result<PickedFile | null>>;
  getLanguage(): Promise<Result<Language>>;
  setLanguage(lang: Language): Promise<Result<null>>;

  /** 弹出文件选择框导入单据（PDF/文本）；用户取消时返回 null */
  importDocument(caseId: string, docType: DocKind): Promise<Result<DocumentRecord | null>>;
  listDocuments(caseId: string): Promise<Result<DocumentRecord[]>>;
  deleteDocument(id: string): Promise<Result<null>>;
  /** 调用外部模型抽取字段；结果已保存，仍须由用户核对 */
  extractDocument(id: string): Promise<Result<ExtractionResult>>;

  /** 读取 / 修正单据的文字（如纠正 OCR 的识别错误）；修正后旧的 AI 抽取结果作废 */
  getDocumentText(id: string): Promise<Result<string>>;
  updateDocumentText(id: string, text: string): Promise<Result<DocumentRecord>>;

  getOcrSettings(): Promise<Result<OcrSettingsInfo>>;
  saveOcrSettings(langs: string): Promise<Result<OcrSettingsInfo>>;
  /** 取消正在进行的文字识别（当前页识别完后停止） */
  cancelOcr(): Promise<Result<null>>;

  /** 导出最近一次审查的报告；弹出「另存为」对话框，用户取消时返回 null */
  exportReport(caseId: string, format: ReportFormat): Promise<Result<ExportedReport | null>>;
  /** 在资源管理器中显示最近导出的报告文件 */
  revealLastExport(): Promise<Result<null>>;

  /** 弹出文件选择框上传手册（PDF / Word / 文本 / 图片）；用户取消时返回 null */
  importManual(): Promise<Result<ManualRecord | null>>;
  listManuals(): Promise<Result<ManualRecord[]>>;
  deleteManual(id: string): Promise<Result<null>>;
  getManualText(id: string): Promise<Result<{ name: string; text: string }>>;
  /** 调用外部模型把手册提炼成「候选」检查项；须经审核启用才生效 */
  extractCheckItems(manualId: string): Promise<Result<ExtractCheckItemsResult>>;
  listCheckItems(): Promise<Result<CheckItem[]>>;
  /** 手工新建检查项（直接启用） */
  createCheckItem(draft: CheckItemDraft): Promise<Result<CheckItem>>;
  updateCheckItem(id: string, draft: CheckItemDraft): Promise<Result<CheckItem>>;
  setCheckItemsStatus(ids: string[], status: CheckStatus): Promise<Result<null>>;
  deleteCheckItem(id: string): Promise<Result<null>>;
  listCountryRules(): Promise<Result<CountryRule[]>>;
  saveCountryRule(id: string | null, draft: CountryRuleDraft): Promise<Result<CountryRule>>;
  deleteCountryRule(id: string): Promise<Result<null>>;

  getStartupState(): Promise<Result<StartupState>>;
  getAppInfo(): Promise<Result<AppInfo>>;
  quitApp(): Promise<Result<null>>;

  getSecurityStatus(): Promise<Result<SecurityStatus>>;
  /** 自检：SQLite 结构、审计哈希链、所有加密列是否都能解开 */
  verifyDatabase(): Promise<Result<{ ok: boolean; problems: string[] }>>;
  /** 导出口令加密的备份（含数据密钥，可在另一台电脑恢复）；用户取消保存对话框时返回 null */
  createBackup(password: string): Promise<Result<BackupResult | null>>;
  /** 选择并校验备份文件，返回预览供用户确认；此时不改动任何数据 */
  inspectBackup(password: string): Promise<Result<RestorePreview | null>>;
  /** 确认恢复：当前数据保留为 pre-restore，随后应用重启 */
  commitRestore(): Promise<Result<null>>;
  cancelRestore(): Promise<Result<null>>;
  setAutoBackup(input: { enabled?: boolean; keep?: number }): Promise<Result<SecurityStatus>>;
  runAutoBackupNow(): Promise<Result<SecurityStatus>>;
  /** 在资源管理器中打开备份目录（路径固定，不接受渲染进程传入） */
  revealBackupFolder(): Promise<Result<null>>;

  getPolicyInfo(): Promise<Result<PolicyInfo>>;
  getUpdateState(): Promise<Result<UpdateState>>;
  checkForUpdates(): Promise<Result<UpdateState>>;
  downloadUpdate(): Promise<Result<UpdateState>>;
  installUpdate(): Promise<Result<boolean>>;

  getAiSettings(): Promise<Result<AiSettings>>;
  saveAiSettings(input: AiSettingsInput): Promise<Result<AiSettings>>;
  testAi(): Promise<Result<null>>;
  /** 从服务端获取当前 Key 可用的模型 ID */
  listAiModels(): Promise<Result<string[]>>;
  listLlmLog(): Promise<Result<LlmLogEntry[]>>;
}

/** 主进程主动推送的事件，返回取消订阅函数 */
export interface LcApi extends LcInvokeApi {
  onLanguageChanged(cb: (lang: Language) => void): () => void;
  onMenuAction(cb: (action: MenuAction) => void): () => void;
  onOcrProgress(cb: (e: OcrProgressEvent) => void): () => void;
  onUpdateState(cb: (s: UpdateState) => void): () => void;
}

export const CHANNELS = [
  "listCases",
  "createCase",
  "getCase",
  "savePresentation",
  "runCase",
  "listRuns",
  "deleteCase",
  "pickLcFile",
  "getLanguage",
  "setLanguage",
  "importDocument",
  "listDocuments",
  "deleteDocument",
  "extractDocument",
  "getDocumentText",
  "updateDocumentText",
  "getOcrSettings",
  "saveOcrSettings",
  "cancelOcr",
  "exportReport",
  "revealLastExport",
  "importManual",
  "listManuals",
  "deleteManual",
  "getManualText",
  "extractCheckItems",
  "listCheckItems",
  "createCheckItem",
  "updateCheckItem",
  "setCheckItemsStatus",
  "deleteCheckItem",
  "listCountryRules",
  "saveCountryRule",
  "deleteCountryRule",
  "getStartupState",
  "getAppInfo",
  "quitApp",
  "getSecurityStatus",
  "verifyDatabase",
  "createBackup",
  "inspectBackup",
  "commitRestore",
  "cancelRestore",
  "setAutoBackup",
  "runAutoBackupNow",
  "revealBackupFolder",
  "getPolicyInfo",
  "getUpdateState",
  "checkForUpdates",
  "downloadUpdate",
  "installUpdate",
  "getAiSettings",
  "saveAiSettings",
  "testAi",
  "listAiModels",
  "listLlmLog",
] as const satisfies readonly (keyof LcInvokeApi)[];
