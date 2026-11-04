import { describe, expect, it } from "vitest";
import { allRules, buildCustomRules, customRuleId, isLcStageRule, localizeFinding, matchText, parseCheckItemDraft, parseMt700, runRules } from "../src";
import type { CheckItem, CheckItemDraft, PresentedText } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const lc = parseMt700(SAMPLE_MT700);
const NOW = "2026-01-01T00:00:00Z";

const item = (over: Partial<CheckItem> & Pick<CheckItem, "id" | "kind" | "scope">): CheckItem => ({
  title: `检查项 ${over.id}`,
  requirement: "要求说明",
  severity: "discrepancy",
  source: { manualId: "m1", manualName: "公司审单清单", quote: "提单须注明 FREIGHT PREPAID" },
  status: "enabled",
  origin: "ai",
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const draft = (over: Record<string, unknown> = {}) => ({
  title: "T",
  requirement: "R",
  kind: "text",
  scope: "transport",
  severity: "doubt",
  textMatch: { mode: "all", phrases: ["FREIGHT PREPAID"] },
  ...over,
});

describe("parseCheckItemDraft", () => {
  it("合法内容通过并规范化（去重、去空白）", () => {
    const r = parseCheckItemDraft(draft({ title: "  提单运费  ", textMatch: { mode: "any", phrases: [" A ", "A", "", "B"] } }));
    expect(r).toEqual({ ok: true, draft: { title: "提单运费", requirement: "R", kind: "text", scope: "transport", severity: "doubt", textMatch: { mode: "any", phrases: ["A", "B"] } } });
  });

  it("逐项拒绝非法输入", () => {
    const err = (o: Record<string, unknown>) => (parseCheckItemDraft(draft(o)) as { error: string }).error;
    expect(err({ title: "" })).toBe("title");
    expect(err({ title: "x".repeat(121) })).toBe("title");
    expect(err({ requirement: " " })).toBe("requirement");
    expect(err({ requirement: "x".repeat(801) })).toBe("requirement");
    expect(err({ kind: "regex" })).toBe("kind");
    expect(err({ scope: "packing" })).toBe("scope");
    expect(err({ severity: "risk" })).toBe("severity");
    expect(err({ textMatch: { mode: "all", phrases: [] } })).toBe("phrases");
    expect(err({ textMatch: { mode: "bad", phrases: ["a"] } })).toBe("phrases");
    expect(err({ textMatch: { mode: "all", phrases: Array(9).fill(0).map((_, i) => `p${i}`) } })).toBe("phrases");
    expect(err({ textMatch: { mode: "all", phrases: ["x".repeat(121)] } })).toBe("phrases");
    expect(parseCheckItemDraft(null)).toMatchObject({ ok: false });
  });

  it("AI 提炼时「文字」类没有有效关键词则降级为「AI 判断」，用户编辑时则报错", () => {
    const bad = draft({ textMatch: undefined });
    expect(parseCheckItemDraft(bad)).toEqual({ ok: false, error: "phrases" });
    const r = parseCheckItemDraft(bad, { downgradeInvalidText: true });
    expect(r).toMatchObject({ ok: true, draft: { kind: "ai" } });
    expect((r as { draft: CheckItemDraft }).draft.textMatch).toBeUndefined();
  });

  it("非「文字」类忽略 textMatch", () => {
    const r = parseCheckItemDraft(draft({ kind: "manual" }));
    expect(r).toMatchObject({ ok: true });
    expect("textMatch" in (r as { draft: object }).draft).toBe(false);
  });
});

describe("matchText", () => {
  it("忽略大小写、换行与多余空白", () => {
    expect(matchText("Freight\n  PREPAID  as arranged", { mode: "all", phrases: ["freight prepaid"] }).ok).toBe(true);
  });
  it("all：列出缺失的词；any：至少一个；none：列出出现的禁用词", () => {
    expect(matchText("A B", { mode: "all", phrases: ["a", "c", "d"] })).toEqual({ ok: false, phrases: ["c", "d"] });
    expect(matchText("only x", { mode: "any", phrases: ["a", "b"] }).ok).toBe(false);
    expect(matchText("has b", { mode: "any", phrases: ["a", "b"] }).ok).toBe(true);
    expect(matchText("this is a SAMPLE copy", { mode: "none", phrases: ["sample", "draft"] })).toEqual({ ok: false, phrases: ["sample"] });
    expect(matchText("clean", { mode: "none", phrases: ["sample"] }).ok).toBe(true);
  });
});

describe("自定义规则执行", () => {
  const docs: PresentedText[] = [
    { docType: "transport", fileName: "bl.pdf", text: "BILL OF LADING\nFREIGHT COLLECT\nShipped on board" },
    { docType: "invoice", fileName: "inv.pdf", text: "COMMERCIAL INVOICE SAMPLE" },
  ];

  it("文字类（单据）：缺词 → 发现；满足 → 通过；只检查对应类型的单据", () => {
    const rules = buildCustomRules([
      item({ id: "a", kind: "text", scope: "transport", textMatch: { mode: "all", phrases: ["FREIGHT PREPAID"] } }),
      item({ id: "b", kind: "text", scope: "transport", textMatch: { mode: "all", phrases: ["Shipped on board"] } }),
    ]);
    const r = runRules(rules, { lc, documents: docs });
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0]!;
    expect(f.ruleId).toBe(customRuleId("a"));
    expect(f.code).toBe("custom.text.missing");
    expect(f.severity).toBe("discrepancy");
    expect(f.stage).toBe("docs");
    expect(f.message).toContain("bl.pdf");
    expect(f.message).toContain("FREIGHT PREPAID");
    // 证据含手册出处
    expect(f.evidence.at(-1)).toEqual({ document: "manual", field: "公司审单清单", value: "提单须注明 FREIGHT PREPAID" });
    expect(f.clause).toBe("Custom: 公司审单清单");
    expect(r.coverage.checked).toEqual([customRuleId("a"), customRuleId("b")]);
  });

  it("不要求录入交单数据，只需导入了对应单据", () => {
    const rules = buildCustomRules([item({ id: "a", kind: "text", scope: "invoice", textMatch: { mode: "none", phrases: ["SAMPLE"] } })]);
    const r = runRules(rules, { lc, presentation: null, documents: docs });
    expect(r.findings.map((f) => f.code)).toEqual(["custom.text.forbidden"]);
  });

  it("没有对应类型的单据时记为未检查，而不是通过", () => {
    const rules = buildCustomRules([item({ id: "a", kind: "text", scope: "insurance", textMatch: { mode: "all", phrases: ["x"] } })]);
    const r = runRules(rules, { lc, documents: docs });
    expect(r.coverage.skipped).toEqual([customRuleId("a")]);
    expect(r.findings).toEqual([]);
    expect(runRules(rules, { lc }).coverage.skipped).toEqual([customRuleId("a")]);
  });

  it("同类型有多份单据时逐份检查", () => {
    const two: PresentedText[] = [
      { docType: "invoice", fileName: "a.pdf", text: "ok PO-1" },
      { docType: "invoice", fileName: "b.pdf", text: "no number" },
    ];
    const rules = buildCustomRules([item({ id: "a", kind: "text", scope: "invoice", textMatch: { mode: "all", phrases: ["PO-1"] } })]);
    const r = runRules(rules, { lc, documents: two });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.message).toContain("b.pdf");
  });

  it("信用证范围的文字检查属于审证，不需要任何单据", () => {
    const rules = buildCustomRules([item({ id: "l", kind: "text", scope: "lc", textMatch: { mode: "none", phrases: ["INSPECTION CERTIFICATE"] } })]);
    const lcWith = { ...lc, raw: { ...lc.raw, "47A": "+INSPECTION CERTIFICATE BY BUYER" } };
    const r = runRules(rules, { lc: lcWith });
    expect(r.findings[0]!.stage).toBe("lc");
    expect(r.findings[0]!.message).toContain("L/C");
    expect(r.coverage.lcRules).toEqual([customRuleId("l")]);
    expect(isLcStageRule(r.coverage, customRuleId("l"))).toBe(true);
  });

  it("人工核对项每次都出现，严重程度取自检查项", () => {
    const rules = buildCustomRules([item({ id: "m", kind: "manual", scope: "invoice", severity: "info", title: "发运前电话确认买方" })]);
    const r = runRules(rules, { lc });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ code: "custom.manual", severity: "info", stage: "docs" }); // 针对发票 → 归入审单
    const lcScope = runRules(buildCustomRules([item({ id: "m2", kind: "manual", scope: "lc" })]), { lc });
    expect(lcScope.findings[0]!.stage).toBe("lc");
  });

  it("只有「已启用」的文字/人工项变成规则；AI 判断项、候选项、停用项都不生成", () => {
    const rules = buildCustomRules([
      item({ id: "1", kind: "text", scope: "invoice", textMatch: { mode: "all", phrases: ["a"] } }),
      item({ id: "2", kind: "text", scope: "invoice", status: "candidate", textMatch: { mode: "all", phrases: ["a"] } }),
      item({ id: "3", kind: "text", scope: "invoice", status: "disabled", textMatch: { mode: "all", phrases: ["a"] } }),
      item({ id: "4", kind: "ai", scope: "invoice" }),
      item({ id: "5", kind: "text", scope: "invoice" }), // 缺 textMatch 的脏数据
    ]);
    expect(rules.map((r) => r.id)).toEqual([customRuleId("1")]);
  });

  it("用户手工添加（无出处）的检查项：证据里没有手册，条款依据标明自定义", () => {
    const rules = buildCustomRules([item({ id: "u", kind: "text", scope: "transport", source: null, origin: "user", textMatch: { mode: "all", phrases: ["ZZZ"] } })]);
    const f = runRules(rules, { lc, documents: docs }).findings[0]!;
    expect(f.clause).toBe("Custom: user-defined");
    expect(f.evidence.some((e) => e.document === "manual")).toBe(false);
  });

  it("与内置规则一起运行互不影响；审证/审单分区标注正确", () => {
    const rules = [...allRules, ...buildCustomRules([item({ id: "a", kind: "text", scope: "transport", textMatch: { mode: "all", phrases: ["NOPE"] } })])];
    const r = runRules(rules, { lc, presentation: { presentationDate: "2024-08-25" }, documents: docs });
    expect(r.errors).toEqual([]);
    expect(r.findings.filter((f) => f.stage === "lc").every((f) => isLcStageRule(r.coverage, f.ruleId))).toBe(true);
    expect(r.findings.find((f) => f.ruleId === customRuleId("a"))!.stage).toBe("docs");
  });

  it("所有自定义文案都有英文版，占位符被填满", () => {
    const rules = buildCustomRules([
      item({ id: "a", kind: "text", scope: "transport", textMatch: { mode: "all", phrases: ["NOPE"] } }),
      item({ id: "b", kind: "text", scope: "transport", textMatch: { mode: "any", phrases: ["NOPE"] } }),
      item({ id: "c", kind: "text", scope: "transport", textMatch: { mode: "none", phrases: ["FREIGHT"] } }),
      item({ id: "d", kind: "manual", scope: "invoice" }),
    ]);
    const r = runRules(rules, { lc, documents: docs });
    expect(new Set(r.findings.map((f) => f.code)).size).toBe(4);
    for (const f of r.findings) {
      const en = localizeFinding(f, "en");
      expect(en.message, f.code).not.toBe(f.message);
      expect(en.message + (en.suggestion ?? ""), f.code).not.toMatch(/\{\w+\}/);
    }
  });
});
