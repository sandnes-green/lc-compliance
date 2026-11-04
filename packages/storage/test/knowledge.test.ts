import { describe, expect, it } from "vitest";
import type { CheckItemDraft } from "@lc/core";
import { customRuleId } from "@lc/core";
import { CaseStore } from "../src";

const LC_TEXT = ":20:K1\n:32B:USD1000,00\n:47A:+DOCUMENTS IN ENGLISH";

const textDraft = (over: Partial<CheckItemDraft> = {}): CheckItemDraft => ({
  title: "提单注明运费预付",
  requirement: "提单须注明 FREIGHT PREPAID",
  kind: "text",
  scope: "transport",
  severity: "discrepancy",
  textMatch: { mode: "all", phrases: ["FREIGHT PREPAID"] },
  ...over,
});

const setup = () => {
  const s = new CaseStore();
  const manual = s.addManual({ name: "公司审单清单", fileName: "list.txt", sourceKind: "text", text: "提单须注明 FREIGHT PREPAID。", chars: 20 });
  const source = { manualId: manual.id, manualName: manual.name, quote: "提单须注明 FREIGHT PREPAID" };
  return { s, manual, source };
};

describe("手册与检查项", () => {
  it("新增手册并读取全文；列表带各状态的检查项数量", () => {
    const { s, manual, source } = setup();
    expect(s.getManualText(manual.id)).toEqual({ name: "公司审单清单", text: "提单须注明 FREIGHT PREPAID。" });
    const [a, b] = s.addCheckItems([
      { draft: textDraft(), source, origin: "ai" },
      { draft: textDraft({ title: "第二条" }), source, origin: "ai" },
    ]);
    s.setCheckItemStatus([a!.id], "enabled");
    expect(s.listManuals()[0]!.items).toEqual({ candidate: 1, enabled: 1, disabled: 0 });
    expect(b!.status).toBe("candidate");
    expect(a!.source).toEqual(source);
    expect(a!.textMatch).toEqual({ mode: "all", phrases: ["FREIGHT PREPAID"] });
  });

  it("修改检查项内容，状态不变；不存在的 ID 报明确错误", () => {
    const { s } = setup();
    const [a] = s.addCheckItems([{ draft: textDraft(), source: null, origin: "user" }], "enabled");
    const u = s.updateCheckItem(a!.id, textDraft({ title: "改名了", severity: "doubt", textMatch: { mode: "any", phrases: ["X", "Y"] } }));
    expect(u).toMatchObject({ title: "改名了", severity: "doubt", status: "enabled", textMatch: { mode: "any", phrases: ["X", "Y"] } });
    expect(u.source).toBeNull();
    expect(() => s.updateCheckItem("nope", textDraft())).toThrowError(expect.objectContaining({ code: "checkItem.notFound" }));
    expect(() => s.setCheckItemStatus(["nope"], "enabled")).toThrowError(expect.objectContaining({ code: "checkItem.notFound" }));
    expect(() => s.deleteCheckItem("nope")).toThrowError(expect.objectContaining({ code: "checkItem.notFound" }));
  });

  it("批量改状态是原子的：其中一个不存在则全部不生效", () => {
    const { s } = setup();
    const [a] = s.addCheckItems([{ draft: textDraft(), source: null, origin: "user" }]);
    expect(() => s.setCheckItemStatus([a!.id, "nope"], "enabled")).toThrow();
    expect(s.listCheckItems()[0]!.status).toBe("candidate");
  });

  it("删除手册后，由它提炼的检查项仍保留出处名称与原文摘录", () => {
    const { s, manual, source } = setup();
    s.addCheckItems([{ draft: textDraft(), source, origin: "ai" }]);
    s.deleteManual(manual.id);
    expect(() => s.getManualText(manual.id)).toThrowError(expect.objectContaining({ code: "manual.notFound" }));
    const [item] = s.listCheckItems();
    expect(item!.source).toEqual({ manualId: null, manualName: "公司审单清单", quote: "提单须注明 FREIGHT PREPAID" });
  });

  it("审计日志不含手册正文", () => {
    const { s } = setup();
    expect(JSON.stringify(s.listAudit())).not.toContain("FREIGHT PREPAID");
    expect(s.verifyAudit()).toBeNull();
  });
});

describe("审查时纳入自定义检查项", () => {
  function caseWithDoc(text: string) {
    const s = new CaseStore();
    const c = s.createCase({ name: "n", lcText: LC_TEXT });
    s.addDocument({ caseId: c.id, docType: "transport", fileName: "bl.pdf", sourceKind: "pdf", text, chars: text.length, needsOcr: false });
    return { s, c };
  }

  it("已启用的文字类检查项按单据原文检查；候选/停用的不参与", () => {
    const { s, c } = caseWithDoc("BILL OF LADING FREIGHT COLLECT");
    const [en, cand, off] = s.addCheckItems([
      { draft: textDraft(), source: null, origin: "user" },
      { draft: textDraft({ title: "候选" }), source: null, origin: "user" },
      { draft: textDraft({ title: "停用" }), source: null, origin: "user" },
    ]);
    s.setCheckItemStatus([en!.id], "enabled");
    s.setCheckItemStatus([off!.id], "disabled");
    void cand;

    const run = s.runCase(c.id);
    const custom = run.findings.filter((f) => f.ruleId.startsWith("CUSTOM-"));
    expect(custom).toHaveLength(1);
    expect(custom[0]).toMatchObject({ ruleId: customRuleId(en!.id), severity: "discrepancy", stage: "docs" });
    expect(run.coverage.checked).toContain(customRuleId(en!.id));
    expect(run.customTitles).toEqual({ [customRuleId(en!.id)]: "提单注明运费预付" });
  });

  it("不需要先保存交单数据；没导入对应单据则记为未检查", () => {
    const { s, c } = caseWithDoc("FREIGHT PREPAID");
    const [it] = s.addCheckItems([{ draft: textDraft({ scope: "insurance" }), source: null, origin: "user" }], "enabled");
    const run = s.runCase(c.id);
    expect(run.presentation).toBeNull();
    expect(run.coverage.skipped).toContain(customRuleId(it!.id));
  });

  it("检查项之后改名或删除，历史审查记录仍保留当时的标题", () => {
    const { s, c } = caseWithDoc("nothing");
    const [it] = s.addCheckItems([{ draft: textDraft(), source: null, origin: "user" }], "enabled");
    const run = s.runCase(c.id);
    s.updateCheckItem(it!.id, textDraft({ title: "新名字" }));
    s.deleteCheckItem(it!.id);
    expect(s.listRuns(c.id)[0]!.customTitles[customRuleId(it!.id)]).toBe("提单注明运费预付");
    expect(s.listRuns(c.id)[0]!.findings.length).toBe(run.findings.length);
  });

  it("合并 AI 判断类检查项的结果：发现、覆盖、错误，并保持严重程度排序", () => {
    const { s, c } = caseWithDoc("x");
    const aiFinding = {
      ruleId: "CUSTOM-ai1", clause: "Custom: m", severity: "discrepancy" as const, code: "custom.ai.notMet", params: {}, message: "AI 发现", evidence: [], stage: "docs" as const,
    };
    const run = s.runCase(c.id, { findings: [aiFinding], checked: ["CUSTOM-ai1"], skipped: ["CUSTOM-ai2"], errors: [{ ruleId: "CUSTOM-AI", message: "超时" }] });
    expect(run.findings[0]!.ruleId).toBe("CUSTOM-ai1"); // 不符点排在前
    expect(run.coverage.checked).toContain("CUSTOM-ai1");
    expect(run.coverage.skipped).toContain("CUSTOM-ai2");
    expect(run.errors).toEqual([{ ruleId: "CUSTOM-AI", message: "超时" }]);
    expect(s.listRuns(c.id)[0]!.findings[0]!.ruleId).toBe("CUSTOM-ai1");
  });

  it("人工核对项每次审查都出现", () => {
    const { s, c } = caseWithDoc("x");
    s.addCheckItems([{ draft: { title: "发运前电话确认", requirement: "电话确认买方", kind: "manual", scope: "invoice", severity: "info" }, source: null, origin: "user" }], "enabled");
    const run = s.runCase(c.id);
    expect(run.findings.some((f) => f.code === "custom.manual")).toBe(true);
  });
});
