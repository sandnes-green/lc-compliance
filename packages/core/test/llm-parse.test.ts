import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient, parseJsonObject } from "../src";
import type { LlmCallRecord } from "../src";

describe("parseJsonObject", () => {
  it("原样 JSON", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("```json 围栏", () => {
    expect(parseJsonObject('```json\n{"ok": true}\n```')).toEqual({ ok: true });
    expect(parseJsonObject('```\n{"ok": true}\n```')).toEqual({ ok: true });
  });
  it("JSON 前后夹带说明文字", () => {
    expect(parseJsonObject('Here is the result:\n{"fields": []}\nHope this helps!')).toEqual({ fields: [] });
  });
  it("数组、标量、非 JSON 一律无效", () => {
    expect(parseJsonObject("[1,2]")).toBeUndefined();
    expect(parseJsonObject("42")).toBeUndefined();
    expect(parseJsonObject("null")).toBeUndefined();
    expect(parseJsonObject("sorry, I cannot do that")).toBeUndefined();
    expect(parseJsonObject("{broken")).toBeUndefined();
  });
});

const respond = (content: string | null, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status });

const make = (responses: Response[], records: LlmCallRecord[] = []) => {
  const fetchImpl = vi.fn(async () => responses.shift() ?? respond(null));
  return new DeepSeekClient({ apiKey: "k", fetchImpl, sleep: async () => {}, maxRetries: 0, onCall: (r) => records.push(r) });
};

describe("DeepSeekClient 返回内容处理", () => {
  it("被围栏包裹的 JSON 能解析，且返回内容写入日志", async () => {
    const records: LlmCallRecord[] = [];
    const c = make([respond('```json\n{"ok":true}\n```')], records);
    expect(await c.completeJson([{ role: "user", content: "json" }])).toEqual({ ok: true });
    expect(records[0]!.outcome).toBe("ok");
    expect(records[0]!.response).toContain('"ok":true');
  });

  it("无法解析时错误和日志都带返回内容的开头", async () => {
    const records: LlmCallRecord[] = [];
    const c = make([respond("I am sorry, I can only answer in prose.")], records);
    await expect(c.completeJson([{ role: "user", content: "json" }])).rejects.toMatchObject({
      kind: "invalid_json",
      preview: "I am sorry, I can only answer in prose.",
    });
    expect(records[0]!.outcome).toBe("invalid_json");
    expect(records[0]!.response).toBe("I am sorry, I can only answer in prose.");
  });

  it("HTTP 200 但响应体不是 JSON（如代理返回网页）时给出明确错误", async () => {
    const c = make([new Response("<html>Blocked by gateway</html>", { status: 200 })]);
    await expect(c.completeJson([{ role: "user", content: "json" }])).rejects.toMatchObject({
      kind: "invalid_json",
      preview: expect.stringContaining("Blocked by gateway"),
    });
  });

  it("空内容的错误带 finish_reason 便于排查", async () => {
    const c = make([respond("")]);
    await expect(c.completeJson([{ role: "user", content: "json" }])).rejects.toMatchObject({ kind: "empty", preview: "finish_reason=stop" });
  });
});
