import { describe, expect, it } from "vitest";
import type { DeepSeekOptions, LlmClient, LlmMessage } from "@lc/core";
import { CaseStore } from "@lc/storage";
import { AiService, MAX_SEND_CHARS, type SecretBox } from "../src";

// 假加密：仅用于验证「落库的不是明文」
const box: SecretBox = {
  encrypt: (p) => `enc:${Buffer.from(p).reverse().toString("base64")}`,
  decrypt: (e) => Buffer.from(e.slice(4), "base64").reverse().toString(),
};

const LC_TEXT = ":20:LC-T\n:32B:USD100000,00";
const INVOICE_TEXT = "COMMERCIAL INVOICE\nDate: 2024-08-12\nTotal Amount: USD 98,500.50\nBank account 6222020200112233445";

function setup(reply: unknown = { fields: [] }) {
  const store = new CaseStore();
  const sent: LlmMessage[][] = [];
  const seen: DeepSeekOptions[] = [];
  const ai = new AiService(store, box, (o) => {
    seen.push(o);
    const client: LlmClient = {
      completeJson: async (messages) => {
        sent.push(messages);
        o.onCall?.({ at: "2024-01-01T00:00:00Z", provider: "deepseek", model: o.model ?? "?", messages, attempt: 0, outcome: "ok" });
        return reply;
      },
    };
    return client;
  });
  const c = store.createCase({ name: "n", lcText: LC_TEXT });
  const doc = store.addDocument({ caseId: c.id, docType: "invoice", fileName: "inv.txt", sourceKind: "text", text: INVOICE_TEXT, chars: 80, needsOcr: false });
  return { store, ai, sent, seen, doc };
}

describe("AiService 设置", () => {
  it("默认关闭、无密钥、脱敏开启", () => {
    const { ai } = setup();
    expect(ai.getSettings()).toEqual({
      enabled: false,
      hasKey: false,
      model: "deepseek-flash",
      redact: true,
      consentAt: null,
      presetModels: ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"],
      blockedByPolicy: false,
    });
  });

  it("首次启用必须同意；同意后记录时间，之后无需再次确认", () => {
    const { ai } = setup();
    expect(() => ai.save({ enabled: true })).toThrowError(expect.objectContaining({ code: "ai.consentRequired" }));
    const s = ai.save({ enabled: true, consent: true });
    expect(s.enabled).toBe(true);
    expect(s.consentAt).not.toBeNull();
    ai.save({ enabled: false });
    expect(ai.save({ enabled: true }).enabled).toBe(true);
  });

  it("密钥加密落库，不会通过设置接口或审计日志泄露", () => {
    const { ai, store } = setup();
    ai.save({ apiKey: "sk-super-secret" });
    expect(store.getSetting("ai.keyEnc")).not.toContain("sk-super-secret");
    expect(JSON.stringify(ai.getSettings())).not.toContain("sk-super-secret");
    expect(JSON.stringify(store.listAudit())).not.toContain("sk-super-secret");
    expect(ai.getSettings().hasKey).toBe(true);
    ai.save({ apiKey: null });
    expect(ai.getSettings().hasKey).toBe(false);
  });

  it("拒绝空密钥与非法模型名", () => {
    const { ai } = setup();
    expect(() => ai.save({ apiKey: "  " })).toThrowError(expect.objectContaining({ code: "ai.invalidKey" }));
    expect(() => ai.save({ model: "bad model!" })).toThrowError(expect.objectContaining({ code: "ai.invalidModel" }));
  });
});

describe("AiService 模型选择", () => {
  const withModels = (models: string[]) => {
    const store = new CaseStore();
    const used: (string | undefined)[] = [];
    const ai = new AiService(store, box, (o) => {
      used.push(o.model);
      return { completeJson: async () => ({}), listModels: async () => models };
    });
    return { ai, used };
  };

  it("未保存密钥时不能获取模型列表", async () => {
    const { ai } = withModels(["a"]);
    await expect(ai.listModels()).rejects.toMatchObject({ code: "ai.noKey" });
  });

  it("只要有密钥即可获取列表，不要求已启用（选模型发生在启用之前）", async () => {
    const { ai } = withModels(["deepseek-flash", "x-model"]);
    ai.save({ apiKey: "k" });
    expect(ai.getSettings().enabled).toBe(false);
    expect(await ai.listModels()).toEqual(["deepseek-flash", "x-model"]);
  });

  it("所选模型被保存，并用于后续请求", async () => {
    const { ai, used } = withModels([]);
    ai.save({ enabled: true, consent: true, apiKey: "k", model: "deepseek-reasoner" });
    expect(ai.getSettings().model).toBe("deepseek-reasoner");
    await ai.test();
    expect(used.at(-1)).toBe("deepseek-reasoner");
  });

  it("服务商客户端不支持列表时给出明确错误", async () => {
    const { ai } = setup();
    ai.save({ apiKey: "k" });
    await expect(ai.listModels()).rejects.toMatchObject({ code: "ai.modelsUnsupported" });
  });
});

describe("AiService 抽取", () => {
  it("未启用 / 未配置密钥时给出明确错误且不发送任何请求", async () => {
    const { ai, doc, sent } = setup();
    await expect(ai.extract(doc.id)).rejects.toMatchObject({ code: "ai.disabled" });
    ai.save({ enabled: true, consent: true });
    await expect(ai.extract(doc.id)).rejects.toMatchObject({ code: "ai.noKey" });
    expect(sent).toHaveLength(0);
  });

  it("完整链路：脱敏后外发、引用校验、结果落库、外发日志留痕", async () => {
    const { ai, store, doc, sent, seen } = setup({
      fields: [
        { name: "currency", value: "USD", quote: "Total Amount: USD 98,500.50" },
        { name: "amount", value: "98500.50", quote: "USD 98,500.50" },
        { name: "date", value: "2024-08-13", quote: "Date: 2024-08-13" }, // 编造的引用
      ],
    });
    ai.save({ enabled: true, consent: true, apiKey: "sk-xyz", model: "deepseek-chat" });

    const r = await ai.extract(doc.id);
    expect(seen[0]!.apiKey).toBe("sk-xyz");
    expect(Object.keys(r.fields)).toEqual(["currency", "amount"]);
    expect(r.rejected).toEqual([{ name: "date", code: "quoteNotFound", reason: "引用不在源文本中" }]);

    // 外发内容已脱敏，但金额/日期保留
    const userMsg = sent[0]!.find((m) => m.role === "user")!.content;
    expect(userMsg).not.toContain("6222020200112233445");
    expect(userMsg).toContain("[ACCOUNT]");
    expect(userMsg).toContain("USD 98,500.50");

    expect(store.listDocuments(doc.caseId)[0]!.extraction).toEqual(r);
    const log = store.listLlmLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.caseId).toBe(doc.caseId);
    expect(JSON.stringify(log)).not.toContain("sk-xyz");
  });

  it("关闭脱敏时原文外发", async () => {
    const { ai, doc, sent } = setup();
    ai.save({ enabled: true, consent: true, apiKey: "k", redact: false });
    await ai.extract(doc.id);
    expect(sent[0]!.find((m) => m.role === "user")!.content).toContain("6222020200112233445");
  });

  it("过长的单据不外发", async () => {
    const { ai, store, sent } = setup();
    const c = store.createCase({ name: "x", lcText: LC_TEXT });
    const big = store.addDocument({ caseId: c.id, docType: "transport", fileName: "b.txt", sourceKind: "text", text: "a".repeat(MAX_SEND_CHARS + 1), chars: MAX_SEND_CHARS + 1, needsOcr: false });
    ai.save({ enabled: true, consent: true, apiKey: "k" });
    await expect(ai.extract(big.id)).rejects.toMatchObject({ code: "doc.tooLong" });
    expect(sent).toHaveLength(0);
  });

  it("连通性测试同样要求启用并写入外发日志", async () => {
    const { ai, store } = setup({ ok: true });
    await expect(ai.test()).rejects.toMatchObject({ code: "ai.disabled" });
    ai.save({ enabled: true, consent: true, apiKey: "k" });
    await ai.test();
    expect(store.listLlmLog()).toHaveLength(1);
  });
});
