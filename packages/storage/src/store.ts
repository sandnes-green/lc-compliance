import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { plainCipher, type Cipher } from "./cipher";
import { allRules, AppError, buildCustomRules, customRuleId, parseMt700, RULESET_VERSION, runRules } from "@lc/core";
import type { CheckItem, CheckItemDraft, CheckItemSource, CheckStatus, ExtractionResult, Finding, LetterOfCredit, LlmCallRecord, LlmMessage, PresentedText, Presentation, RunResult } from "@lc/core";

export { RULESET_VERSION };

// Vite/Vitest 会把 "node:sqlite" 的前缀剥掉导致找不到模块，故用运行时 API 取内置模块
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

export interface CaseSummary {
  id: string;
  name: string;
  lcReference: string;
  updatedAt: string;
}

export interface CaseRecord extends CaseSummary {
  createdAt: string;
  lcText: string;
  lc: LetterOfCredit;
  presentation: Presentation | null;
}

export interface RunRecord {
  id: number;
  caseId: string;
  at: string;
  rulesetVersion: string;
  findings: Finding[];
  errors: RunResult["errors"];
  /** 哪些规则已检查、哪些因缺少数据而未检查（旧记录为空） */
  coverage: RunResult["coverage"];
  /** 本次审查中自定义检查项的标题快照（检查项之后被改名或删除，历史结果仍可读） */
  customTitles: Record<string, string>;
  /** 本次审查所用的交单数据快照；之后再改数据也不影响历史结果的可解释性（旧记录或仅审证时为 null） */
  presentation: Presentation | null;
}

export interface ManualRecord {
  id: string;
  name: string;
  fileName: string;
  sourceKind: "pdf" | "text" | "image" | "docx";
  chars: number;
  ocrConfidence: number | null;
  createdAt: string;
  /** 由它提炼出的检查项数量（按状态） */
  items: { candidate: number; enabled: number; disabled: number };
}

/** AI 判断类检查项的审查结果，由服务层在调用 runCase 前算好后一并落库 */
export interface RunExtra {
  findings?: Finding[];
  checked?: string[];
  skipped?: string[];
  errors?: RunResult["errors"];
}

export type DocKind = "invoice" | "transport" | "insurance";

export interface DocumentRecord {
  id: string;
  caseId: string;
  docType: DocKind;
  fileName: string;
  sourceKind: "pdf" | "text" | "image";
  chars: number;
  needsOcr: boolean;
  createdAt: string;
  extraction: ExtractionResult | null;
  extractedAt: string | null;
  /** 经 OCR 识别时的平均置信度 0..100；非 OCR 来源为 null */
  ocrConfidence: number | null;
}

export interface LlmLogEntry {
  id: number;
  at: string;
  provider: string;
  model: string;
  caseId: string | null;
  attempt: number;
  outcome: string;
  messages: LlmMessage[];
  /** 模型返回内容（或失败时的原始返回片段） */
  response: string | null;
}

const LLM_LOG_KEEP = 500;

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  caseId: string | null;
  detail: unknown;
  hash: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  lc_reference TEXT NOT NULL,
  lc_text TEXT NOT NULL,
  lc_json TEXT NOT NULL,
  presentation_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  errors_json TEXT NOT NULL,
  coverage_json TEXT,
  presentation_json TEXT,
  custom_json TEXT
);
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  text TEXT NOT NULL,
  chars INTEGER NOT NULL,
  needs_ocr INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  extraction_json TEXT,
  extracted_at TEXT,
  ocr_confidence REAL
);
CREATE TABLE IF NOT EXISTS llm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  case_id TEXT,
  attempt INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  response TEXT
);
CREATE TABLE IF NOT EXISTS manuals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  text TEXT NOT NULL,
  chars INTEGER NOT NULL,
  ocr_confidence REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS check_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  requirement TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT NOT NULL,
  severity TEXT NOT NULL,
  text_match_json TEXT,
  source_manual_id TEXT,
  source_manual_name TEXT,
  source_quote TEXT,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  case_id TEXT,
  detail_json TEXT NOT NULL,
  hash TEXT NOT NULL
);
`;

/**
 * 加密列：表 → 列。含敏感内容的列必须登记在这里；测试会逐列核对数据库里确实是密文。
 * 未登记的是元数据（ID、时间、状态、计数、规则 ID 等），不含单据、手册或案件内容。
 */
export const SECRET_COLUMNS = {
  cases: ["name", "lc_reference", "lc_text", "lc_json", "presentation_json"],
  runs: ["findings_json", "errors_json", "coverage_json", "presentation_json", "custom_json"],
  documents: ["file_name", "text", "extraction_json"],
  manuals: ["name", "file_name", "text"],
  check_items: ["title", "requirement", "text_match_json", "source_manual_name", "source_quote"],
  llm_log: ["messages_json", "response"],
  audit_log: ["detail_json"],
} as const;

const META_ENCRYPTED = "encrypted";
const META_CANARY = "canary";
const CANARY_PLAIN = "lc-compliance-key-ok";

const notFound = (id: string) => new AppError("case.notFound", `案件不存在：${id}`, { id });

const GENESIS = "0".repeat(64);

type Row = Record<string, string | number | null>;

export class CaseStore {
  private readonly db: DatabaseSyncType;
  private readonly cipher: Cipher;

  /**
   * @param opts.cipher 提供时，敏感列以密文存放。数据库一旦被加密就不能再不带密钥打开（会明确报错，而不是读出乱码）；
   *                    首次以加密方式打开一个旧的明文库时，会在一个事务里整体加密。
   */
  constructor(path: string = ":memory:", opts: { cipher?: Cipher } = {}) {
    this.cipher = opts.cipher ?? plainCipher;
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
      this.db.exec(SCHEMA);
      this.migrate();
      this.initEncryption();
    } catch (e) {
      // 打不开（密钥缺失/不对、迁移失败等）时必须释放文件句柄，否则在 Windows 上文件会一直被占用，无法替换或恢复
      this.db.close();
      throw e;
    }
  }

  // ───────────── 加密 ─────────────

  private getMeta(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as Row | undefined;
    return (r?.value as string | undefined) ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  /** 数据库是否已加密（以库内标记为准） */
  get encrypted(): boolean {
    return this.getMeta(META_ENCRYPTED) === "1";
  }

  private initEncryption(): void {
    const marked = this.encrypted;
    if (marked && !this.cipher.enabled) {
      throw new AppError("db.keyRequired", "数据库已加密，需要密钥才能打开", {});
    }
    if (!this.cipher.enabled) return; // 明文模式（测试 / 未配置密钥）
    if (marked) {
      // 用金丝雀值确认密钥正确：密钥丢失或不对时给出明确错误
      const canary = this.getMeta(META_CANARY);
      try {
        if (canary === null || this.cipher.open("meta.canary", canary) !== CANARY_PLAIN) throw new Error("bad canary");
      } catch {
        throw new AppError("db.wrongKey", "数据密钥与数据库不匹配，无法解密", {});
      }
      return;
    }
    this.encryptExisting();
  }

  /**
   * 把旧的明文数据整体加密。全部在一个事务里：先逐值加密并回读比对，任何一处不一致都整体回滚，
   * 数据库保持原样。成功后清理写前日志并 VACUUM，让旧明文页不再留在文件里。
   */
  private encryptExisting(): void {
    this.tx(() => {
      for (const [table, cols] of Object.entries(SECRET_COLUMNS)) {
        const rows = this.db.prepare(`SELECT rowid AS rid, ${cols.join(",")} FROM ${table}`).all() as Row[];
        const update = this.db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE rowid = ?`);
        for (const r of rows) {
          const sealed = cols.map((c) => {
            const v = r[c];
            if (v === null || v === undefined) return null;
            const out = this.cipher.seal(`${table}.${c}`, String(v));
            if (this.cipher.open(`${table}.${c}`, out) !== String(v)) throw new AppError("db.encryptVerifyFailed", `加密校验失败：${table}.${c}`, {});
            return out;
          });
          update.run(...sealed, r.rid as number);
        }
      }
      this.setMeta(META_CANARY, this.cipher.seal("meta.canary", CANARY_PLAIN));
      this.setMeta(META_ENCRYPTED, "1");
    });
    // 事务之外：截断 WAL，并重写数据库文件以清除被替换掉的明文页
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.exec("VACUUM");
  }

  private seal(table: keyof typeof SECRET_COLUMNS, col: string, v: string | null | undefined): string | null {
    if (v === null || v === undefined) return null;
    return this.cipher.enabled ? this.cipher.seal(`${table}.${col}`, v) : v;
  }

  private open(table: keyof typeof SECRET_COLUMNS, col: string, v: unknown): string | null {
    if (v === null || v === undefined) return null;
    return this.cipher.enabled ? this.cipher.open(`${table}.${col}`, String(v)) : String(v);
  }

  /** 读取并解析 JSON 列；列为空返回 null */
  private openJson<T>(table: keyof typeof SECRET_COLUMNS, col: string, v: unknown): T | null {
    const t = this.open(table, col, v);
    return t === null ? null : (JSON.parse(t) as T);
  }

  /**
   * 生成一致的数据库快照（VACUUM INTO）。快照里的敏感列仍是密文，因此快照本身不泄露内容。
   * 目标文件必须不存在。
   */
  backupTo(path: string): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    this.db.prepare("VACUUM INTO ?").run(path);
  }

  /** 完整性自检：SQLite 结构完整、审计哈希链完整，且所有加密列都能解开 */
  verifyIntegrity(): { ok: boolean; problems: string[] } {
    const problems: string[] = [];
    const ic = (this.db.prepare("PRAGMA integrity_check").all() as Row[]).map((r) => String(Object.values(r)[0]));
    if (ic.length !== 1 || ic[0] !== "ok") problems.push(`sqlite: ${ic.join("; ")}`);
    try {
      for (const [table, cols] of Object.entries(SECRET_COLUMNS)) {
        for (const r of this.db.prepare(`SELECT ${cols.join(",")} FROM ${table}`).all() as Row[]) {
          for (const c of cols) this.open(table as keyof typeof SECRET_COLUMNS, c, r[c]);
        }
      }
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
    const bad = problems.length === 0 ? this.verifyAudit() : null;
    if (bad !== null) problems.push(`audit: 记录 ${bad} 被篡改或缺失`);
    return { ok: problems.length === 0, problems };
  }

  /** 旧版本数据库补列（CREATE TABLE IF NOT EXISTS 不会修改已存在的表） */
  private migrate(): void {
    const columns = (table: string) => (this.db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((r) => r.name);
    if (!columns("llm_log").includes("response")) this.db.exec("ALTER TABLE llm_log ADD COLUMN response TEXT");
    if (!columns("documents").includes("ocr_confidence")) this.db.exec("ALTER TABLE documents ADD COLUMN ocr_confidence REAL");
    if (!columns("runs").includes("custom_json")) this.db.exec("ALTER TABLE runs ADD COLUMN custom_json TEXT");
    if (!columns("runs").includes("presentation_json")) this.db.exec("ALTER TABLE runs ADD COLUMN presentation_json TEXT");
    if (!columns("runs").includes("coverage_json")) this.db.exec("ALTER TABLE runs ADD COLUMN coverage_json TEXT");
  }

  close(): void {
    this.db.close();
  }

  /** 解析失败（Mt700Error）时不落库，错误原样抛给调用方展示 */
  createCase(input: { name: string; lcText: string }): CaseRecord {
    const lc = parseMt700(input.lcText);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.tx(() => {
      this.db
        .prepare(
          "INSERT INTO cases (id,name,lc_reference,lc_text,lc_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(id, this.seal("cases", "name", input.name), this.seal("cases", "lc_reference", lc.reference), this.seal("cases", "lc_text", input.lcText), this.seal("cases", "lc_json", JSON.stringify(lc)), now, now);
      this.audit("case.create", id, { name: input.name, lcReference: lc.reference });
    });
    return this.getCase(id)!;
  }

  listCases(): CaseSummary[] {
    return (this.db.prepare("SELECT id,name,lc_reference,updated_at FROM cases ORDER BY updated_at DESC").all() as Row[]).map(
      (r) => ({ id: r.id as string, name: this.open("cases", "name", r.name)!, lcReference: this.open("cases", "lc_reference", r.lc_reference)!, updatedAt: r.updated_at as string }),
    );
  }

  getCase(id: string): CaseRecord | null {
    const r = this.db.prepare("SELECT * FROM cases WHERE id = ?").get(id) as Row | undefined;
    if (!r) return null;
    return {
      id: r.id as string,
      name: this.open("cases", "name", r.name)!,
      lcReference: this.open("cases", "lc_reference", r.lc_reference)!,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      lcText: this.open("cases", "lc_text", r.lc_text)!,
      lc: this.openJson("cases", "lc_json", r.lc_json)!,
      presentation: this.openJson("cases", "presentation_json", r.presentation_json),
    };
  }

  savePresentation(caseId: string, presentation: Presentation): void {
    this.tx(() => {
      const res = this.db
        .prepare("UPDATE cases SET presentation_json = ?, updated_at = ? WHERE id = ?")
        .run(this.seal("cases", "presentation_json", JSON.stringify(presentation)), new Date().toISOString(), caseId);
      if (res.changes === 0) throw notFound(caseId);
      this.audit("presentation.save", caseId, presentation);
    });
  }

  /**
   * 执行规则并落库：内置规则 + 已启用的自定义「文字」「人工」检查项（同步、确定性）。
   * 「AI 判断」类由服务层事先算好，经 extra 传入。尚未录入交单数据时只做审证与单据文字检查。
   */
  runCase(caseId: string, extra: RunExtra = {}): RunRecord {
    const c = this.getCase(caseId);
    if (!c) throw notFound(caseId);
    const items = this.listCheckItems().filter((i) => i.status === "enabled");
    const result = runRules([...allRules, ...buildCustomRules(items)], { lc: c.lc, presentation: c.presentation, documents: this.listDocumentTexts(caseId) });

    // 合并 AI 判断类检查项的结果
    const ORDER = { discrepancy: 0, risk: 1, doubt: 2, info: 3 } as const;
    const findings = [...result.findings, ...(extra.findings ?? [])].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
    const errors = [...result.errors, ...(extra.errors ?? [])];
    const coverage = {
      checked: [...result.coverage.checked, ...(extra.checked ?? [])],
      skipped: [...result.coverage.skipped, ...(extra.skipped ?? [])],
      lcRules: result.coverage.lcRules,
    };
    const customTitles = Object.fromEntries(items.map((i) => [customRuleId(i.id), i.title]));

    const at = new Date().toISOString();
    let runId = 0;
    this.tx(() => {
      const res = this.db
        .prepare("INSERT INTO runs (case_id,at,ruleset_version,findings_json,errors_json,coverage_json,presentation_json,custom_json) VALUES (?,?,?,?,?,?,?,?)")
        .run(
          caseId,
          at,
          RULESET_VERSION,
          this.seal("runs", "findings_json", JSON.stringify(findings)),
          this.seal("runs", "errors_json", JSON.stringify(errors)),
          this.seal("runs", "coverage_json", JSON.stringify(coverage)),
          this.seal("runs", "presentation_json", c.presentation ? JSON.stringify(c.presentation) : null),
          this.seal("runs", "custom_json", JSON.stringify({ titles: customTitles })),
        );
      runId = Number(res.lastInsertRowid);
      this.audit("case.run", caseId, {
        runId,
        findings: findings.length,
        errors: errors.length,
        checked: coverage.checked.length,
        skipped: coverage.skipped.length,
        customItems: items.length,
      });
    });
    return { id: runId, caseId, at, rulesetVersion: RULESET_VERSION, findings, errors, coverage, presentation: c.presentation, customTitles };
  }

  listRuns(caseId: string): RunRecord[] {
    return (this.db.prepare("SELECT * FROM runs WHERE case_id = ? ORDER BY id DESC").all(caseId) as Row[]).map((r) => ({
      id: r.id as number,
      caseId: r.case_id as string,
      at: r.at as string,
      rulesetVersion: r.ruleset_version as string,
      findings: this.openJson<RunRecord["findings"]>("runs", "findings_json", r.findings_json) ?? [],
      errors: this.openJson<RunRecord["errors"]>("runs", "errors_json", r.errors_json) ?? [],
      coverage: this.openJson<RunRecord["coverage"]>("runs", "coverage_json", r.coverage_json) ?? { checked: [], skipped: [] },
      presentation: this.openJson<Presentation>("runs", "presentation_json", r.presentation_json),
      customTitles: this.openJson<{ titles?: Record<string, string> }>("runs", "custom_json", r.custom_json)?.titles ?? {},
    }));
  }

  deleteCase(caseId: string): void {
    this.tx(() => {
      this.db.prepare("DELETE FROM cases WHERE id = ?").run(caseId);
      this.audit("case.delete", caseId, {});
    });
  }

  addDocument(input: { caseId: string; docType: DocKind; fileName: string; sourceKind: "pdf" | "text" | "image"; text: string; chars: number; needsOcr: boolean; ocrConfidence?: number | null }): DocumentRecord {
    if (!this.getCase(input.caseId)) throw notFound(input.caseId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.tx(() => {
      this.db
        .prepare("INSERT INTO documents (id,case_id,doc_type,file_name,source_kind,text,chars,needs_ocr,created_at,ocr_confidence) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, input.caseId, input.docType, this.seal("documents", "file_name", input.fileName), input.sourceKind, this.seal("documents", "text", input.text), input.chars, input.needsOcr ? 1 : 0, now, input.ocrConfidence ?? null);
      this.audit("document.add", input.caseId, { id, docType: input.docType, fileName: input.fileName, chars: input.chars });
    });
    return this.listDocuments(input.caseId).find((d) => d.id === id)!;
  }

  listDocuments(caseId: string): DocumentRecord[] {
    const rows = this.db
      .prepare("SELECT id,case_id,doc_type,file_name,source_kind,chars,needs_ocr,created_at,extraction_json,extracted_at,ocr_confidence FROM documents WHERE case_id = ? ORDER BY created_at")
      .all(caseId) as Row[];
    return rows.map((r) => ({
      id: r.id as string,
      caseId: r.case_id as string,
      docType: r.doc_type as DocKind,
      fileName: this.open("documents", "file_name", r.file_name)!,
      sourceKind: r.source_kind as "pdf" | "text" | "image",
      chars: r.chars as number,
      needsOcr: r.needs_ocr === 1,
      createdAt: r.created_at as string,
      extraction: this.openJson<ExtractionResult>("documents", "extraction_json", r.extraction_json),
      extractedAt: (r.extracted_at as string | null) ?? null,
      ocrConfidence: (r.ocr_confidence as number | null) ?? null,
    }));
  }

  /** 单据全文（较大，故与列表分开读取） */
  getDocumentText(id: string): { caseId: string; docType: DocKind; text: string } {
    const r = this.db.prepare("SELECT case_id,doc_type,text FROM documents WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new AppError("doc.notFound", `单据不存在：${id}`, { id });
    return { caseId: r.case_id as string, docType: r.doc_type as DocKind, text: this.open("documents", "text", r.text)! };
  }

  /**
   * 人工修正单据文字（如纠正 OCR 的识别错误）。文字变了，之前的 AI 抽取结果就不再可信，一并清除。
   * 审计只记录字数，不记录正文。
   */
  updateDocumentText(id: string, text: string): DocumentRecord {
    const { caseId } = this.getDocumentText(id);
    const chars = text.replace(/\s/g, "").length;
    if (chars === 0) throw new AppError("doc.empty", "文字内容为空", {});
    this.tx(() => {
      this.db.prepare("UPDATE documents SET text = ?, chars = ?, extraction_json = NULL, extracted_at = NULL, needs_ocr = 0 WHERE id = ?").run(this.seal("documents", "text", text), chars, id);
      this.audit("document.edit", caseId, { id, chars });
    });
    return this.listDocuments(caseId).find((d) => d.id === id)!;
  }

  saveExtraction(id: string, extraction: ExtractionResult): void {
    const { caseId } = this.getDocumentText(id);
    this.tx(() => {
      this.db.prepare("UPDATE documents SET extraction_json = ?, extracted_at = ? WHERE id = ?").run(this.seal("documents", "extraction_json", JSON.stringify(extraction)), new Date().toISOString(), id);
      this.audit("document.extract", caseId, { id, accepted: Object.keys(extraction.fields), rejected: extraction.rejected.length });
    });
  }

  deleteDocument(id: string): void {
    const { caseId } = this.getDocumentText(id);
    this.tx(() => {
      this.db.prepare("DELETE FROM documents WHERE id = ?").run(id);
      this.audit("document.delete", caseId, { id });
    });
  }

  /** 记录一次发往外部模型的请求（含发送内容，不含密钥），仅保留最近 500 条 */
  logLlmCall(r: LlmCallRecord, caseId: string | null): void {
    this.db
      .prepare("INSERT INTO llm_log (at,provider,model,case_id,attempt,outcome,messages_json,response) VALUES (?,?,?,?,?,?,?,?)")
      .run(r.at, r.provider, r.model, caseId, r.attempt, r.outcome, this.seal("llm_log", "messages_json", JSON.stringify(r.messages)), this.seal("llm_log", "response", r.response ?? null));
    this.db.prepare("DELETE FROM llm_log WHERE id <= (SELECT MAX(id) FROM llm_log) - ?").run(LLM_LOG_KEEP);
  }

  listLlmLog(limit = 100): LlmLogEntry[] {
    return (this.db.prepare("SELECT * FROM llm_log ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map((r) => ({
      id: r.id as number,
      at: r.at as string,
      provider: r.provider as string,
      model: r.model as string,
      caseId: (r.case_id as string | null) ?? null,
      attempt: r.attempt as number,
      outcome: r.outcome as string,
      messages: this.openJson<LlmMessage[]>("llm_log", "messages_json", r.messages_json) ?? [],
      response: this.open("llm_log", "response", r.response),
    }));
  }

  /** 本案件全部有文字的单据原文，供自定义检查项按原文核对 */
  listDocumentTexts(caseId: string): PresentedText[] {
    return (this.db.prepare("SELECT doc_type,file_name,text FROM documents WHERE case_id = ? AND chars > 0 ORDER BY created_at").all(caseId) as Row[]).map((r) => ({
      docType: r.doc_type as PresentedText["docType"],
      fileName: this.open("documents", "file_name", r.file_name)!,
      text: this.open("documents", "text", r.text)!,
    }));
  }

  // ───────────── 手册知识库 ─────────────

  addManual(input: { name: string; fileName: string; sourceKind: ManualRecord["sourceKind"]; text: string; chars: number; ocrConfidence?: number | null }): ManualRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.tx(() => {
      this.db
        .prepare("INSERT INTO manuals (id,name,file_name,source_kind,text,chars,ocr_confidence,created_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, this.seal("manuals", "name", input.name), this.seal("manuals", "file_name", input.fileName), input.sourceKind, this.seal("manuals", "text", input.text), input.chars, input.ocrConfidence ?? null, now);
      this.audit("manual.add", null, { id, name: input.name, chars: input.chars });
    });
    return this.listManuals().find((m) => m.id === id)!;
  }

  listManuals(): ManualRecord[] {
    const counts = new Map<string, ManualRecord["items"]>();
    for (const r of this.db.prepare("SELECT source_manual_id id, status, COUNT(*) n FROM check_items WHERE source_manual_id IS NOT NULL GROUP BY source_manual_id, status").all() as Row[]) {
      const c = counts.get(r.id as string) ?? { candidate: 0, enabled: 0, disabled: 0 };
      c[r.status as CheckStatus] = r.n as number;
      counts.set(r.id as string, c);
    }
    return (this.db.prepare("SELECT id,name,file_name,source_kind,chars,ocr_confidence,created_at FROM manuals ORDER BY created_at DESC, rowid DESC").all() as Row[]).map((r) => ({
      id: r.id as string,
      name: this.open("manuals", "name", r.name)!,
      fileName: this.open("manuals", "file_name", r.file_name)!,
      sourceKind: r.source_kind as ManualRecord["sourceKind"],
      chars: r.chars as number,
      ocrConfidence: (r.ocr_confidence as number | null) ?? null,
      createdAt: r.created_at as string,
      items: counts.get(r.id as string) ?? { candidate: 0, enabled: 0, disabled: 0 },
    }));
  }

  getManualText(id: string): { name: string; text: string } {
    const r = this.db.prepare("SELECT name,text FROM manuals WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new AppError("manual.notFound", `手册不存在：${id}`, { id });
    return { name: this.open("manuals", "name", r.name)!, text: this.open("manuals", "text", r.text)! };
  }

  /** 删除手册；由它提炼的检查项保留（出处名称与原文摘录已随检查项存档） */
  deleteManual(id: string): void {
    this.getManualText(id);
    this.tx(() => {
      this.db.prepare("DELETE FROM manuals WHERE id = ?").run(id);
      this.db.prepare("UPDATE check_items SET source_manual_id = NULL WHERE source_manual_id = ?").run(id);
      this.audit("manual.delete", null, { id });
    });
  }

  // ───────────── 自定义检查项 ─────────────

  private rowToItem(r: Row): CheckItem {
    const source: CheckItemSource | null =
      r.source_quote !== null
        ? { manualId: (r.source_manual_id as string | null) ?? null, manualName: this.open("check_items", "source_manual_name", r.source_manual_name) ?? "", quote: this.open("check_items", "source_quote", r.source_quote)! }
        : null;
    return {
      id: r.id as string,
      title: this.open("check_items", "title", r.title)!,
      requirement: this.open("check_items", "requirement", r.requirement)!,
      kind: r.kind as CheckItem["kind"],
      scope: r.scope as CheckItem["scope"],
      severity: r.severity as CheckItem["severity"],
      ...(r.text_match_json ? { textMatch: this.openJson<NonNullable<CheckItem["textMatch"]>>("check_items", "text_match_json", r.text_match_json)! } : {}),
      source,
      status: r.status as CheckStatus,
      origin: r.origin as CheckItem["origin"],
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    };
  }

  listCheckItems(): CheckItem[] {
    return (this.db.prepare("SELECT * FROM check_items ORDER BY created_at, rowid").all() as Row[]).map((r) => this.rowToItem(r));
  }

  /** 批量新增。AI 提炼的先作为「候选」，须经用户审核启用；用户手工添加的可直接指定状态 */
  addCheckItems(inputs: { draft: CheckItemDraft; source: CheckItemSource | null; origin: CheckItem["origin"] }[], status: CheckStatus = "candidate"): CheckItem[] {
    const now = new Date().toISOString();
    const ids: string[] = [];
    this.tx(() => {
      const stmt = this.db.prepare(
        "INSERT INTO check_items (id,title,requirement,kind,scope,severity,text_match_json,source_manual_id,source_manual_name,source_quote,status,origin,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      for (const { draft: d, source, origin } of inputs) {
        const id = randomUUID();
        ids.push(id);
        stmt.run(
          id,
          this.seal("check_items", "title", d.title),
          this.seal("check_items", "requirement", d.requirement),
          d.kind,
          d.scope,
          d.severity,
          this.seal("check_items", "text_match_json", d.textMatch ? JSON.stringify(d.textMatch) : null),
          source?.manualId ?? null,
          this.seal("check_items", "source_manual_name", source?.manualName ?? null),
          this.seal("check_items", "source_quote", source?.quote ?? null),
          status,
          origin,
          now,
          now,
        );
      }
      this.audit("checkItem.add", null, { count: inputs.length, status, origin: inputs[0]?.origin });
    });
    const all = this.listCheckItems();
    return ids.map((id) => all.find((i) => i.id === id)!);
  }

  /** 修改检查项内容（调用方须已用 parseCheckItemDraft 校验），状态保持不变 */
  updateCheckItem(id: string, d: CheckItemDraft): CheckItem {
    this.requireItem(id);
    this.tx(() => {
      this.db
        .prepare("UPDATE check_items SET title=?,requirement=?,kind=?,scope=?,severity=?,text_match_json=?,updated_at=? WHERE id=?")
        .run(
          this.seal("check_items", "title", d.title),
          this.seal("check_items", "requirement", d.requirement),
          d.kind,
          d.scope,
          d.severity,
          this.seal("check_items", "text_match_json", d.textMatch ? JSON.stringify(d.textMatch) : null),
          new Date().toISOString(),
          id,
        );
      this.audit("checkItem.update", null, { id });
    });
    return this.listCheckItems().find((i) => i.id === id)!;
  }

  setCheckItemStatus(ids: string[], status: CheckStatus): void {
    this.tx(() => {
      const stmt = this.db.prepare("UPDATE check_items SET status=?,updated_at=? WHERE id=?");
      const now = new Date().toISOString();
      for (const id of ids) {
        this.requireItem(id);
        stmt.run(status, now, id);
      }
      this.audit("checkItem.status", null, { ids, status });
    });
  }

  deleteCheckItem(id: string): void {
    this.requireItem(id);
    this.tx(() => {
      this.db.prepare("DELETE FROM check_items WHERE id = ?").run(id);
      this.audit("checkItem.delete", null, { id });
    });
  }

  private requireItem(id: string): void {
    if (!this.db.prepare("SELECT 1 FROM check_items WHERE id = ?").get(id)) throw new AppError("checkItem.notFound", `检查项不存在：${id}`, { id });
  }

  /** 记录与具体案件无关的审计事件（如设置变更）；detail 中不得包含密钥或单据正文 */
  logEvent(action: string, detail: unknown, caseId: string | null = null): void {
    this.tx(() => this.audit(action, caseId, detail));
  }

  getSetting(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return (r?.value as string | undefined) ?? null;
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  listAudit(): AuditEntry[] {
    return (this.db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Row[]).map((r) => ({
      id: r.id as number,
      at: r.at as string,
      action: r.action as string,
      caseId: r.case_id as string | null,
      detail: this.openJson("audit_log", "detail_json", r.detail_json),
      hash: r.hash as string,
    }));
  }

  /** 校验审计哈希链；返回第一条被篡改/缺失记录的 id，完整则返回 null */
  verifyAudit(): number | null {
    let prev = GENESIS;
    for (const r of this.db.prepare("SELECT * FROM audit_log ORDER BY id").all() as Row[]) {
      let detail: string | null;
      try {
        detail = this.open("audit_log", "detail_json", r.detail_json);
      } catch {
        return r.id as number; // 解不开（被改动过）同样视为被篡改
      }
      const expect = hashEntry(prev, r.at as string, r.action as string, r.case_id as string | null, detail ?? "");
      if (expect !== r.hash) return r.id as number;
      prev = expect;
    }
    return null;
  }

  private audit(action: string, caseId: string | null, detail: unknown): void {
    const last = this.db.prepare("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1").get() as Row | undefined;
    const at = new Date().toISOString();
    const detailJson = JSON.stringify(detail);
    const hash = hashEntry((last?.hash as string) ?? GENESIS, at, action, caseId, detailJson);
    this.db.prepare("INSERT INTO audit_log (at,action,case_id,detail_json,hash) VALUES (?,?,?,?,?)").run(at, action, caseId, this.seal("audit_log", "detail_json", detailJson), hash);
  }

  private tx(fn: () => void): void {
    this.db.exec("BEGIN");
    try {
      fn();
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** 仅供测试篡改审计记录 */
  _unsafeExec(sql: string): void {
    this.db.exec(sql);
  }
}

function hashEntry(prev: string, at: string, action: string, caseId: string | null, detailJson: string): string {
  return createHash("sha256").update([prev, at, action, caseId ?? "", detailJson].join("\n")).digest("hex");
}

/** 不需要密钥地查看数据库状态：文件是否存在、是否已加密（读库内标记） */
export function inspectDatabase(path: string): { exists: boolean; encrypted: boolean } {
  if (path === ":memory:" || !existsSync(path)) return { exists: false, encrypted: false };
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
    if (!hasMeta) return { exists: true, encrypted: false };
    const r = db.prepare("SELECT value FROM meta WHERE key = 'encrypted'").get() as { value?: string } | undefined;
    return { exists: true, encrypted: r?.value === "1" };
  } finally {
    db.close();
  }
}
