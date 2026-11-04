import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { LlmError, customRuleId } from "@lc/core";
import type { CheckItem, LlmClient, LlmMessage } from "@lc/core";
import type { OcrResult } from "@lc/docs";
import { CaseStore } from "@lc/storage";
import { AiService, MAX_MANUAL_CHARS, chunkText, extractCheckItems, importManual, judgeAiItems, runCaseWithChecks, type OcrRunner, type SecretBox } from "../src";
import { makePdf } from "../../docs/test/make-pdf";

const box: SecretBox = { encrypt: (p) => `enc:${p}`, decrypt: (e) => e.slice(4) };
const LC_TEXT = ":20:KB1\n:32B:USD1000,00\n:47A:+DOCUMENTS IN ENGLISH";

type Responder = (messages: LlmMessage[], call: number) => unknown;

function setup(opts: { enabled?: boolean; responder?: Responder } = {}) {
  const store = new CaseStore();
  const sent: LlmMessage[][] = [];
  let call = 0;
  const ai = new AiService(store, box, (o) => {
    const client: LlmClient = {
      completeJson: async (messages) => {
        sent.push(messages);
        o.onCall?.({ at: "2026-01-01T00:00:00Z", provider: "fake", model: "m", messages, attempt: 0, outcome: "ok" });
        const r = (opts.responder ?? (() => ({})))(messages, call++);
        if (r instanceof Error) throw r;
        return r;
      },
    };
    return client;
  });
  if (opts.enabled !== false) ai.save({ enabled: true, consent: true, apiKey: "k" });
  return { store, ai, sent };
}

const MANUAL = ["一、提单", "提单须注明 FREIGHT PREPAID。", "二、发票", "发票须与合同货物描述一致，不得有矛盾表述。", "三、其他", "发运前须电话确认买方。"].join("\n");

const item = (over: Record<string, unknown> = {}) => ({
  title: "提单注明运费预付",
  requirement: "提单须注明 FREIGHT PREPAID",
  scope: "transport",
  kind: "text",
  severity: "discrepancy",
  mode: "all",
  phrases: ["FREIGHT PREPAID"],
  quote: "提单须注明 FREIGHT PREPAID",
  ...over,
});

const addManual = (store: CaseStore, text = MANUAL) => store.addManual({ name: "公司清单", fileName: "list.txt", sourceKind: "text", text, chars: text.length });

describe("importManual", () => {
  it("文本文件：名称默认取文件名（去扩展名），可自定义", async () => {
    const { store } = setup();
    const a = await importManual(store, { fileName: "公司审单清单.txt", data: new TextEncoder().encode(MANUAL) });
    expect(a).toMatchObject({ name: "公司审单清单", sourceKind: "text", ocrConfidence: null });
    const b = await importManual(store, { fileName: "x.txt", data: new TextEncoder().encode("abc"), name: "  客户 A 要求  " });
    expect(b.name).toBe("客户 A 要求");
  });

  it("Word 文件：提取正文", async () => {
    const { store } = setup();
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>发票须含合同号</w:t></w:r></w:p></w:body></w:document>`);
    const m = await importManual(store, { fileName: "客户要求.docx", data: await zip.generateAsync({ type: "uint8array" }) });
    expect(m.sourceKind).toBe("docx");
    expect(store.getManualText(m.id).text).toBe("发票须含合同号");
  });

  it("扫描件：有 OCR 时识别并记录置信度；没有 OCR 时明确报错", async () => {
    const { store } = setup();
    const pdf = await makePdf([[]]);
    await expect(importManual(store, { fileName: "scan.pdf", data: pdf })).rejects.toMatchObject({ code: "ocr.unavailable" });
    const ocr: OcrRunner = {
      pdf: async () => ({ kind: "pdf", pages: ["扫描的手册文字 FREIGHT PREPAID"], text: "扫描的手册文字 FREIGHT PREPAID", chars: 20, needsOcr: false, confidence: 88, pageConfidence: [88] }) as OcrResult,
      image: async () => {
        throw new Error("unused");
      },
    };
    const m = await importManual(store, { fileName: "scan.pdf", data: pdf }, ocr);
    expect(m.ocrConfidence).toBe(88);
    expect(store.listManuals()).toHaveLength(1);
  });
});

describe("chunkText", () => {
  it("按行切分且每段不超过上限，内容与顺序保持不变", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `第 ${i} 行 ${"x".repeat(30)}`);
    const chunks = chunkText(lines.join("\n"), 200);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join("\n").split("\n")).toEqual(lines);
  });
  it("单行过长时硬切；空文本得到空数组", () => {
    const chunks = chunkText("a".repeat(450), 200);
    expect(chunks.map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunkText("  \n ", 200)).toEqual([]);
  });
});

describe("extractCheckItems", () => {
  it("把有效条目存为「候选」，附手册出处；无效、无依据、编造依据、重复、范围错误的被丢弃并说明原因", async () => {
    const { store, ai } = setup({
      responder: () => ({
        items: [
          item(),
          item({ title: "发票描述一致", requirement: "发票货描须与合同一致", scope: "invoice", kind: "ai", severity: "discrepancy", quote: "发票须与合同货物描述一致" }), // 严重程度被纠正
          item({ title: "电话确认买方", requirement: "发运前电话确认买方", scope: "invoice", kind: "manual", severity: "info", quote: "发运前须电话确认买方" }),
          item({ title: "没给关键词的文字项", scope: "transport", phrases: [], quote: "提单须注明 FREIGHT PREPAID" }), // 降级为 ai
          item({ title: "", quote: "提单须注明 FREIGHT PREPAID" }), // invalid
          item({ title: "范围错误", scope: "packing" }), // invalid
          item({ title: "无依据", quote: "" }),
          item({ title: "编造依据", quote: "手册里根本没有这句话" }),
          item(), // 与第一条重复
        ],
      }),
    });
    const m = addManual(store);
    const r = await extractCheckItems(store, ai, m.id);

    expect(r.created.map((i) => i.title)).toEqual(["提单注明运费预付", "发票描述一致", "电话确认买方", "没给关键词的文字项"]);
    expect(r.created.every((i) => i.status === "candidate" && i.origin === "ai")).toBe(true);
    expect(r.created[0]!.source).toEqual({ manualId: m.id, manualName: "公司清单", quote: "提单须注明 FREIGHT PREPAID" });
    expect(r.created[0]!.textMatch).toEqual({ mode: "all", phrases: ["FREIGHT PREPAID"] });
    expect(r.created[1]).toMatchObject({ kind: "ai", severity: "doubt" }); // AI 判断类不能是不符点
    expect(r.created[3]).toMatchObject({ kind: "ai" });
    expect(r.created[3]!.textMatch).toBeUndefined();
    expect(r.dropped.map((d) => d.reason)).toEqual(["invalid", "invalid", "noQuote", "quoteNotFound", "duplicate"]);
    expect(store.listCheckItems()).toHaveLength(4);
  });

  it("再次提炼同一份手册不会产生重复项", async () => {
    const { store, ai } = setup({ responder: () => ({ items: [item()] }) });
    const m = addManual(store);
    expect((await extractCheckItems(store, ai, m.id)).created).toHaveLength(1);
    const again = await extractCheckItems(store, ai, m.id);
    expect(again.created).toEqual([]);
    expect(again.dropped).toEqual([{ title: "提单注明运费预付", reason: "duplicate" }]);
  });

  it("发送前脱敏；提示词把手册标注为不可信数据；调用进入外发日志", async () => {
    const { store, ai, sent } = setup({ responder: () => ({ items: [] }) });
    const m = addManual(store, "提单须注明 FREIGHT PREPAID。付款账号 6222020200112233445。");
    await extractCheckItems(store, ai, m.id);
    const user = sent[0]!.find((x) => x.role === "user")!.content;
    expect(user).toContain("[ACCOUNT]");
    expect(user).not.toContain("6222020200112233445");
    expect(sent[0]![0]!.content).toMatch(/untrusted/);
    expect(store.listLlmLog()).toHaveLength(1);
  });

  it("未启用 AI：明确报错且不发送任何内容", async () => {
    const { store, ai, sent } = setup({ enabled: false });
    const m = addManual(store);
    await expect(extractCheckItems(store, ai, m.id)).rejects.toMatchObject({ code: "ai.disabled" });
    expect(sent).toHaveLength(0);
  });

  it("手册过长时拒绝，不外发", async () => {
    const { store, ai, sent } = setup();
    const m = addManual(store, "a".repeat(MAX_MANUAL_CHARS + 1));
    await expect(extractCheckItems(store, ai, m.id)).rejects.toMatchObject({ code: "manual.tooLong" });
    expect(sent).toHaveLength(0);
  });

  it("长手册分段处理：依据只对其所在分段有效；任一分段失败则整体不入库", async () => {
    const pad = "补充说明".repeat(15);
    const lines = Array.from({ length: 400 }, (_, i) => `第${i}条：单据须注明编号 NO-${i}。${pad}`);
    const long = lines.join("\n");
    const mk = (n: number) => item({ title: `条 ${n}`, requirement: `须注明 NO-${n}`, phrases: [`NO-${n}`], quote: `单据须注明编号 NO-${n}` });
    {
      const { store, ai, sent } = setup({
        // 第 1 段里除了第 0 条，还错误地给出第 399 条（它的依据不在该段）→ 应被丢弃；第 399 条在最后一段才成立
        responder: (m) => {
          const doc = m.find((x) => x.role === "user")!.content;
          const items = [];
          if (doc.includes("编号 NO-0。")) items.push(mk(0), mk(399));
          if (doc.includes("编号 NO-399。")) items.push(mk(399));
          return { items };
        },
      });
      const m = addManual(store, long);
      const r = await extractCheckItems(store, ai, m.id);
      expect(sent.length).toBeGreaterThan(2);
      expect(r.created.map((i) => i.title)).toEqual(["条 0", "条 399"]);
      expect(r.dropped).toEqual([{ title: "条 399", reason: "quoteNotFound" }]);
    }
    {
      const { store, ai } = setup({ responder: (_m, call) => (call === 1 ? new LlmError("网络错误", "network") : { items: [mk(0)] }) });
      const m = addManual(store, long);
      await expect(extractCheckItems(store, ai, m.id)).rejects.toBeInstanceOf(LlmError);
      expect(store.listCheckItems()).toEqual([]);
    }
  });

  it("单份手册最多 60 条，其余记为超限；返回结构异常时视为没有条目", async () => {
    const many = Array.from({ length: 70 }, (_, i) => item({ title: `条 ${i}`, quote: "提单须注明 FREIGHT PREPAID" }));
    const { store, ai } = setup({ responder: () => ({ items: many }) });
    const r = await extractCheckItems(store, ai, addManual(store).id);
    expect(r.created).toHaveLength(60);
    expect(r.dropped.filter((d) => d.reason === "overLimit")).toHaveLength(10);

    const bad = setup({ responder: () => "oops" });
    expect((await extractCheckItems(bad.store, bad.ai, addManual(bad.store).id)).created).toEqual([]);
  });
});

// ───────── AI 判断 ─────────

const aiItem = (over: Partial<CheckItem> = {}): CheckItem => ({
  id: "i1",
  title: "货描无矛盾",
  requirement: "发票货物描述不得有矛盾表述",
  kind: "ai",
  scope: "invoice",
  severity: "doubt",
  source: { manualId: "m", manualName: "公司清单", quote: "发票须与合同货物描述一致" },
  status: "enabled",
  origin: "ai",
  createdAt: "",
  updatedAt: "",
  ...over,
});

const INV = { docType: "invoice" as const, fileName: "inv.pdf", text: "COMMERCIAL INVOICE\n1000 SETS OF WIDGETS\nShipped by sea" };
const lcOf = () => {
  const s = new CaseStore();
  return s.createCase({ name: "n", lcText: LC_TEXT }).lc;
};

describe("judgeAiItems", () => {
  const run = (responder: Responder, items: CheckItem[], documents = [INV], enabled = true) => {
    const t = setup({ responder, enabled });
    return judgeAiItems(t.store, t.ai, { lc: lcOf(), documents, items }).then((extra) => ({ extra, ...t }));
  };

  it("「满足」且引用真实存在 → 通过，不产生发现", async () => {
    const { extra } = await run(() => ({ results: [{ n: 1, verdict: "met", quote: "1000 SETS OF WIDGETS", reason: "ok" }] }), [aiItem()]);
    expect(extra.findings).toEqual([]);
    expect(extra.checked).toEqual([customRuleId("i1")]);
  });

  it("「满足」但引用是编造的 → 降级为「无法判断」的疑点", async () => {
    const { extra } = await run(() => ({ results: [{ n: 1, verdict: "met", quote: "这句话单据里没有", reason: "ok" }] }), [aiItem()]);
    expect(extra.findings).toHaveLength(1);
    expect(extra.findings[0]).toMatchObject({ code: "custom.ai.unclear", severity: "doubt", stage: "docs" });
  });

  it("「不满足」：最重只到疑点（即使检查项设为不符点），带 AI 说明与手册出处", async () => {
    const { extra } = await run(() => ({ results: [{ n: 1, verdict: "not_met", quote: "Shipped by sea", reason: "与要求矛盾" }] }), [aiItem({ severity: "discrepancy" })]);
    const f = extra.findings[0]!;
    expect(f).toMatchObject({ code: "custom.ai.notMet", severity: "doubt" });
    expect(f.message).toContain("— 与要求矛盾");
    expect(f.message).toContain("需人工确认");
    expect(f.evidence[0]).toEqual({ document: "invoice", field: "inv.pdf", value: "Shipped by sea" });
    expect(f.evidence.at(-1)!.document).toBe("manual");
  });

  it("不满足时给的引用不在单据中 → 不展示该引用", async () => {
    const { extra } = await run(() => ({ results: [{ n: 1, verdict: "not_met", quote: "编造", reason: "" }] }), [aiItem()]);
    expect(extra.findings[0]!.evidence[0]!.value).toBe("—");
    expect(extra.findings[0]!.message).not.toContain("—  ");
  });

  it("检查项严重程度为「提示」时保持提示；结果缺失视为无法判断", async () => {
    const { extra } = await run(() => ({ results: [] }), [aiItem({ severity: "info" })]);
    expect(extra.findings[0]).toMatchObject({ code: "custom.ai.unclear", severity: "info" });
  });

  it("多条检查项按编号对应结果，提示词含编号与单据原文", async () => {
    const items = [aiItem({ id: "a", requirement: "要求甲" }), aiItem({ id: "b", requirement: "要求乙" })];
    const { extra, sent } = await run(
      () => ({ results: [{ n: 1, verdict: "met", quote: "COMMERCIAL INVOICE", reason: "" }, { n: 2, verdict: "not_met", quote: "", reason: "缺" }] }),
      items,
    );
    expect(sent).toHaveLength(1);
    const user = sent[0]!.find((m) => m.role === "user")!.content;
    expect(user).toContain("1. 要求甲");
    expect(user).toContain("2. 要求乙");
    expect(user).toContain("COMMERCIAL INVOICE");
    expect(extra.findings.map((f) => f.ruleId)).toEqual([customRuleId("b")]);
    expect(extra.checked).toEqual([customRuleId("a"), customRuleId("b")]);
  });

  it("每份同类型单据各判断一次，发现里标明文件名", async () => {
    const docs = [INV, { ...INV, fileName: "inv2.pdf" }];
    const { extra, sent } = await run(() => ({ results: [{ n: 1, verdict: "not_met", quote: "", reason: "" }] }), [aiItem()], docs);
    expect(sent).toHaveLength(2);
    expect(extra.findings.map((f) => f.params.file)).toEqual(["inv.pdf", "inv2.pdf"]);
  });

  it("信用证范围：以信用证原文为判断对象，归入审证", async () => {
    const { extra, sent } = await run(() => ({ results: [{ n: 1, verdict: "not_met", quote: "", reason: "" }] }), [aiItem({ scope: "lc" })], []);
    expect(sent[0]!.find((m) => m.role === "user")!.content).toContain("DOCUMENTS IN ENGLISH");
    expect(extra.findings[0]).toMatchObject({ stage: "lc" });
    expect(extra.findings[0]!.params.file).toBe("L/C");
  });

  it("没有对应类型的单据 → 未检查；候选/停用的 AI 项不参与；非 AI 项忽略", async () => {
    const items = [aiItem({ id: "ins", scope: "insurance" }), aiItem({ id: "cand", status: "candidate" }), aiItem({ id: "txt", kind: "text" })];
    const { extra, sent } = await run(() => ({}), items);
    expect(extra.skipped).toEqual([customRuleId("ins")]);
    expect(extra.checked).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("未启用 AI → 全部记为未检查，没有错误、不发送", async () => {
    const { extra, sent } = await run(() => ({}), [aiItem()], [INV], false);
    expect(extra).toEqual({ findings: [], checked: [], skipped: [customRuleId("i1")], errors: [] });
    expect(sent).toHaveLength(0);
  });

  it("请求失败：记录错误并把该项记为未检查，不影响其他单据", async () => {
    const docs = [INV, { ...INV, fileName: "inv2.pdf" }];
    const { extra } = await run((_m, call) => (call === 0 ? new LlmError("余额不足", "balance") : { results: [{ n: 1, verdict: "not_met", quote: "", reason: "" }] }), [aiItem()], docs);
    expect(extra.errors).toEqual([{ ruleId: "CUSTOM-AI", message: "inv.pdf: 余额不足" }]);
    expect(extra.findings.map((f) => f.params.file)).toEqual(["inv2.pdf"]);
    expect(extra.checked).toEqual([customRuleId("i1")]); // 另一份判断成功
  });

  it("全部请求都失败 → 未检查", async () => {
    const { extra } = await run(() => new LlmError("超时", "network"), [aiItem()]);
    expect(extra.skipped).toEqual([customRuleId("i1")]);
    expect(extra.errors).toHaveLength(1);
  });
});

describe("runCaseWithChecks", () => {
  function withCase(responder: Responder, enabled = true) {
    const t = setup({ responder, enabled });
    const c = t.store.createCase({ name: "n", lcText: LC_TEXT });
    t.store.addDocument({ caseId: c.id, docType: "invoice", fileName: "inv.pdf", sourceKind: "pdf", text: INV.text, chars: 50, needsOcr: false });
    const [ai1] = t.store.addCheckItems([{ draft: { title: "货描无矛盾", requirement: "发票货物描述不得有矛盾表述", kind: "ai", scope: "invoice", severity: "doubt" }, source: null, origin: "user" }], "enabled");
    return { ...t, c, ai1: ai1! };
  }

  it("合并 AI 判断结果：发现、覆盖、标题快照", async () => {
    const { store, ai, c, ai1 } = withCase(() => ({ results: [{ n: 1, verdict: "not_met", quote: "", reason: "缺" }] }));
    const run = await runCaseWithChecks(store, ai, c.id);
    expect(run.findings.some((f) => f.ruleId === customRuleId(ai1.id))).toBe(true);
    expect(run.coverage.checked).toContain(customRuleId(ai1.id));
    expect(run.customTitles[customRuleId(ai1.id)]).toBe("货描无矛盾");
  });

  it("AI 未启用时审查照常完成，AI 项显示为未检查", async () => {
    const { store, ai, c, ai1 } = withCase(() => ({}), false);
    const run = await runCaseWithChecks(store, ai, c.id);
    expect(run.coverage.skipped).toContain(customRuleId(ai1.id));
    expect(run.errors).toEqual([]);
  });

  it("没有 AI 判断项时不调用模型；案件不存在时报统一错误", async () => {
    const t = setup({ responder: () => ({}) });
    const c = t.store.createCase({ name: "n", lcText: LC_TEXT });
    await runCaseWithChecks(t.store, t.ai, c.id);
    expect(t.sent).toHaveLength(0);
    await expect(runCaseWithChecks(t.store, t.ai, "nope")).rejects.toMatchObject({ code: "case.notFound" });
  });
});
