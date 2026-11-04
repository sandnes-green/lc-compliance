import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient, LlmError, extractFields, redact, toInvoiceData } from "../src";
import type { LlmCallRecord, LlmClient } from "../src";

const reply = (content: string | null, init: { status?: number; finish?: string } = {}) =>
  new Response(
    init.status && init.status >= 400
      ? "err"
      : JSON.stringify({ choices: [{ message: { content }, finish_reason: init.finish ?? "stop" }] }),
    { status: init.status ?? 200 },
  );

const client = (responses: Response[], extra: Partial<ConstructorParameters<typeof DeepSeekClient>[0]> = {}) => {
  const fetchImpl = vi.fn(async () => responses.shift() ?? reply(null));
  return { fetchImpl, c: new DeepSeekClient({ apiKey: "sk-secret", fetchImpl, sleep: async () => {}, ...extra }) };
};

describe("DeepSeekClient", () => {
  it("发送 OpenAI 兼容请求并解析 JSON", async () => {
    const { c, fetchImpl } = client([reply('{"a":1}')]);
    expect(await c.completeJson([{ role: "user", content: "give json" }])).toEqual({ a: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "deepseek-flash", response_format: { type: "json_object" }, temperature: 0 });
  });

  it("提示词缺少 json 字样时自动补充", async () => {
    const { c, fetchImpl } = client([reply("{}")]);
    await c.completeJson([{ role: "user", content: "hello" }]);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content).toMatch(/json/i);
  });

  it("空内容、429、5xx 会重试，之后成功", async () => {
    const { c, fetchImpl } = client([reply(null), reply("", { status: 429 }), reply("", { status: 503 }), reply('{"ok":true}')], { maxRetries: 3 });
    expect(await c.completeJson([{ role: "user", content: "json" }])).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("重试耗尽后抛出最后一个错误", async () => {
    const { c, fetchImpl } = client([reply(null), reply(null), reply(null)]);
    await expect(c.completeJson([{ role: "user", content: "json" }])).rejects.toMatchObject({ kind: "empty" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    [401, "auth"],
    [402, "balance"],
    [400, "bad_request"],
  ])("HTTP %i 不重试，错误类型 %s", async (status, kind) => {
    const { c, fetchImpl } = client([reply("", { status })]);
    await expect(c.completeJson([{ role: "user", content: "json" }])).rejects.toMatchObject({ kind });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("输出被截断时报错而不是解析半截 JSON", async () => {
    const { c } = client([reply('{"a":', { finish: "length" })]);
    await expect(c.completeJson([{ role: "user", content: "json" }])).rejects.toMatchObject({ kind: "truncated" });
  });

  it("外发日志记录消息内容但不含 API Key", async () => {
    const records: LlmCallRecord[] = [];
    const { c } = client([reply("{}")], { onCall: (r) => records.push(r) });
    await c.completeJson([{ role: "user", content: "json please" }]);
    expect(records).toHaveLength(1);
    expect(records[0]!.messages[0]!.content).toBe("json please");
    expect(JSON.stringify(records)).not.toContain("sk-secret");
  });

  it("缺少 Key 时构造失败", () => {
    expect(() => new DeepSeekClient({ apiKey: "" })).toThrow(LlmError);
  });
});

describe("extractFields 引用校验", () => {
  const text = "COMMERCIAL INVOICE\nDate: 2024-08-12\nTotal   Amount: USD 98,500.50\nPay to account 6222020200112233445";
  const fake = (fields: unknown): LlmClient => ({ completeJson: async () => ({ fields }) });

  it("合法字段被采纳（引用忽略空白与大小写差异）", async () => {
    const r = await extractFields(
      fake([
        { name: "currency", value: "USD", quote: "total amount: usd 98,500.50" },
        { name: "amount", value: "98500.50", quote: "USD 98,500.50" },
        { name: "date", value: "2024-08-12", quote: "Date: 2024-08-12" },
      ]),
      "invoice",
      text,
    );
    expect(r.rejected).toEqual([]);
    expect(toInvoiceData(r)).toEqual({ currency: "USD", amount: 98500.5, date: "2024-08-12" });
  });

  it("拒绝：无引用、编造引用、值与引用不符、非法日期、越界字段、重复", async () => {
    const r = await extractFields(
      fake([
        { name: "amount", value: "98500.50" },
        { name: "currency", value: "USD", quote: "Currency: USD" },
        { name: "date", value: "2024-02-30", quote: "Date: 2024-08-12" },
        { name: "amount", value: "99999", quote: "USD 98,500.50" },
        { name: "buyer", value: "X", quote: "COMMERCIAL INVOICE" },
        { name: "date", value: "2024-08-12", quote: "Date: 2024-08-12" },
        { name: "date", value: "2024-08-12", quote: "Date: 2024-08-12" },
      ]),
      "invoice",
      text,
    );
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "缺少原文引用",
      "引用不在源文本中",
      "日期不存在",
      "金额未出现在引用中",
      "不在抽取范围内",
      "重复字段",
    ]);
    expect(Object.keys(r.fields)).toEqual(["date"]);
  });

  it("模型返回结构异常时得到空结果", async () => {
    const r = await extractFields({ completeJson: async () => "oops" }, "transport", text);
    expect(r).toEqual({ fields: {}, rejected: [] });
  });
});

describe("redact", () => {
  it("遮蔽账号/邮箱/IBAN/电话，保留金额与日期", () => {
    const out = redact("a@b.com GB82WEST12345698765432 6222020200112233445 +86 138 0013 8000 USD 98,500.50 2024-08-12");
    expect(out).toBe("[EMAIL] [IBAN] [ACCOUNT] [PHONE] USD 98,500.50 2024-08-12");
  });
});
