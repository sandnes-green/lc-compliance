import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
import { Mt700Error } from "@lc/core";
import { CaseStore, RULESET_VERSION } from "../src";

// 合成样本，非真实数据
const LC_TEXT = `:20:LC-T-1
:31D:240930NEW YORK
:32B:USD100000,00
:39A:05/05
:44C:240820
:48:21 DAYS AFTER SHIPMENT`;

describe("CaseStore", () => {
  it("创建案件、解析 L/C、列表与读取", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "测试案件", lcText: LC_TEXT });
    expect(c.lcReference).toBe("LC-T-1");
    expect(c.lc.amount).toBe(100000);
    expect(c.presentation).toBeNull();
    expect(s.listCases().map((x) => x.id)).toEqual([c.id]);
  });

  it("L/C 无法解析时不落库也不写审计", () => {
    const s = new CaseStore();
    expect(() => s.createCase({ name: "bad", lcText: ":20:X" })).toThrow(Mt700Error);
    expect(s.listCases()).toEqual([]);
    expect(s.listAudit()).toEqual([]);
  });

  it("尚未录入交单数据时只做审证，审单规则记为未检查", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });
    const run = s.runCase(c.id);
    expect(run.coverage.checked.every((id) => id.startsWith("LCR-"))).toBe(true);
    expect(run.coverage.skipped).toContain("UCP600-18-INVOICE-AMOUNT");
    expect(run.findings.filter((f) => f.severity === "discrepancy")).toEqual([]);
  });

  it("录入交单数据后执行审查并保留历次结果", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });

    s.savePresentation(c.id, {
      presentationDate: "2024-09-05",
      invoice: { currency: "USD", amount: 120000 },
      transport: { shipmentDate: "2024-08-21" },
    });
    const run1 = s.runCase(c.id);
    expect(run1.rulesetVersion).toBe(RULESET_VERSION);
    const bad = (r: typeof run1) => r.findings.filter((f) => f.severity === "discrepancy").map((f) => f.ruleId).sort();
    expect(bad(run1)).toEqual(["UCP600-18-INVOICE-AMOUNT", "UCP600-20-LATEST-SHIPMENT"]);
    expect(run1.coverage.checked).toContain("UCP600-18-INVOICE-AMOUNT");

    s.savePresentation(c.id, { presentationDate: "2024-08-25", invoice: { currency: "USD", amount: 100000 }, transport: { shipmentDate: "2024-08-10" } });
    const run2 = s.runCase(c.id);
    expect(bad(run2)).toEqual([]);
    expect(s.listRuns(c.id).map((r) => r.id)).toEqual([run2.id, run1.id]);
    expect(s.listRuns(c.id)[0]!.coverage).toEqual(run2.coverage);
  });

  it("每次审查保存当时的交单数据快照，之后修改数据不影响历史记录", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });
    expect(s.runCase(c.id).presentation).toBeNull(); // 仅审证
    const p1 = { presentationDate: "2024-08-25", invoice: { currency: "USD", amount: 1 } };
    s.savePresentation(c.id, p1);
    const run = s.runCase(c.id);
    expect(run.presentation).toEqual(p1);
    s.savePresentation(c.id, { presentationDate: "2024-09-09", invoice: { currency: "USD", amount: 2 } });
    expect(s.listRuns(c.id).find((r) => r.id === run.id)!.presentation).toEqual(p1);
  });

  it("旧版数据库（审查记录无 coverage 列）自动迁移，旧记录覆盖情况为空", () => {
    const dir = mkdtempSync(join(tmpdir(), "lc-migrate2-"));
    try {
      const file = join(dir, "old.db");
      const first = new CaseStore(file);
      const c = first.createCase({ name: "n", lcText: LC_TEXT });
      first.close();
      const raw = new DatabaseSync(file);
      raw.exec("ALTER TABLE runs DROP COLUMN coverage_json");
      raw.prepare("INSERT INTO runs (case_id,at,ruleset_version,findings_json,errors_json) VALUES (?,?,?,?,?)").run(c.id, "2026-01-01T00:00:00Z", "ucp600-0.1.0", "[]", "[]");
      raw.close();

      const s = new CaseStore(file);
      expect(s.listRuns(c.id)[0]!.coverage).toEqual({ checked: [], skipped: [] });
      expect(s.runCase(c.id).coverage.checked.length).toBeGreaterThan(0);
      s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("保存不存在案件的交单数据会失败且不写审计", () => {
    const s = new CaseStore();
    expect(() => s.savePresentation("nope", { presentationDate: "2024-01-01" })).toThrow(/不存在/);
    expect(s.listAudit()).toEqual([]);
  });

  it("删除案件级联删除审查记录", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });
    s.savePresentation(c.id, { presentationDate: "2024-08-25" });
    s.runCase(c.id);
    s.deleteCase(c.id);
    expect(s.getCase(c.id)).toBeNull();
    expect(s.listRuns(c.id)).toEqual([]);
  });

  it("审计哈希链完整，篡改后可定位", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });
    s.savePresentation(c.id, { presentationDate: "2024-08-25" });
    s.runCase(c.id);
    expect(s.verifyAudit()).toBeNull();
    expect(s.listAudit().map((a) => a.action)).toEqual(["case.create", "presentation.save", "case.run"]);

    s._unsafeExec(`UPDATE audit_log SET detail_json = '{"hacked":true}' WHERE id = 2`);
    expect(s.verifyAudit()).toBe(2);
  });

  it("业务错误带稳定编码，供界面本地化", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });
    expect(() => s.runCase("nope")).toThrowError(expect.objectContaining({ code: "case.notFound" }));
  });

  it("设置项可读写并覆盖", () => {
    const s = new CaseStore();
    expect(s.getSetting("language")).toBeNull();
    s.setSetting("language", "en");
    s.setSetting("language", "zh");
    expect(s.getSetting("language")).toBe("zh");
  });

  it("单据：保存文本、抽取结果，删除案件级联删除", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });
    expect(() => s.addDocument({ caseId: "nope", docType: "invoice", fileName: "a.pdf", sourceKind: "pdf", text: "x", chars: 1, needsOcr: false })).toThrowError(
      expect.objectContaining({ code: "case.notFound" }),
    );
    const d = s.addDocument({ caseId: c.id, docType: "invoice", fileName: "inv.pdf", sourceKind: "pdf", text: "Total USD 100", chars: 11, needsOcr: false });
    expect(d.extraction).toBeNull();
    expect(s.getDocumentText(d.id)).toEqual({ caseId: c.id, docType: "invoice", text: "Total USD 100" });

    s.saveExtraction(d.id, { fields: { currency: { value: "USD", quote: "USD 100" } }, rejected: [{ name: "amount", code: "noQuote", reason: "缺少原文引用" }] });
    const [loaded] = s.listDocuments(c.id);
    expect(loaded!.extraction!.fields.currency!.value).toBe("USD");
    expect(loaded!.extractedAt).not.toBeNull();
    expect(JSON.stringify(s.listAudit())).not.toContain("Total USD 100"); // 审计日志不含单据正文

    s.deleteCase(c.id);
    expect(() => s.getDocumentText(d.id)).toThrowError(expect.objectContaining({ code: "doc.notFound" }));
  });

  it("外发日志保留发送内容，并只保留最近 500 条", () => {
    const s = new CaseStore();
    const rec = (i: number) => ({ at: new Date(i).toISOString(), provider: "deepseek", model: "m", attempt: 0, outcome: "ok" as const, messages: [{ role: "user" as const, content: `msg ${i}` }] });
    for (let i = 0; i < 505; i++) s.logLlmCall(rec(i), null);
    const all = s.listLlmLog(1000);
    expect(all).toHaveLength(500);
    expect(all[0]!.messages[0]!.content).toBe("msg 504");
    expect(all.at(-1)!.messages[0]!.content).toBe("msg 5");
  });

  it("旧版数据库（外发日志无 response 列）打开时自动迁移，并保存返回内容", () => {
    const dir = mkdtempSync(join(tmpdir(), "lc-migrate-"));
    try {
      const file = join(dir, "old.db");
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE llm_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, case_id TEXT, attempt INTEGER NOT NULL, outcome TEXT NOT NULL, messages_json TEXT NOT NULL);
        INSERT INTO llm_log (at,provider,model,attempt,outcome,messages_json) VALUES ('2026-01-01T00:00:00Z','deepseek','m',0,'invalid_json','[]');`);
      old.close();

      const s = new CaseStore(file);
      expect(s.listLlmLog()[0]!.response).toBeNull(); // 旧记录
      s.logLlmCall({ at: "2026-01-02T00:00:00Z", provider: "deepseek", model: "m", attempt: 0, outcome: "ok", messages: [], response: '{"ok":true}' }, null);
      expect(s.listLlmLog()[0]!.response).toBe('{"ok":true}');
      s.close();
      new CaseStore(file).close(); // 重复打开不应因已有列而报错
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("数据持久化到磁盘文件", () => {
    const dir = mkdtempSync(join(tmpdir(), "lc-store-"));
    try {
      const file = join(dir, "t.db");
      const a = new CaseStore(file);
      const c = a.createCase({ name: "persist", lcText: LC_TEXT });
      a.close();
      const b = new CaseStore(file);
      expect(b.getCase(c.id)?.name).toBe("persist");
      expect(b.verifyAudit()).toBeNull();
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
