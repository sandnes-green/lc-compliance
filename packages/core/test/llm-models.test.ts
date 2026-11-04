import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DEEPSEEK_MODEL, DeepSeekClient } from "../src";

const client = (res: Response) => {
  const fetchImpl = vi.fn(async () => res);
  return { c: new DeepSeekClient({ apiKey: "sk-secret", fetchImpl }), fetchImpl };
};

describe("DeepSeekClient.listModels", () => {
  it("默认模型为 deepseek-flash", () => {
    expect(DEFAULT_DEEPSEEK_MODEL).toBe("deepseek-flash");
  });

  it("GET /models，带 Bearer 认证；结果去重并排序，忽略无效项", async () => {
    const body = { object: "list", data: [{ id: "deepseek-reasoner" }, { id: "deepseek-flash" }, { id: "deepseek-flash" }, { id: "" }, { nope: 1 }, null] };
    const { c, fetchImpl } = client(new Response(JSON.stringify(body)));
    expect(await c.listModels()).toEqual(["deepseek-flash", "deepseek-reasoner"]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/models");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-secret");
    expect(init.method).toBeUndefined(); // GET
  });

  it("Key 无效、余额不足映射为明确的错误类型", async () => {
    await expect(client(new Response("", { status: 401 })).c.listModels()).rejects.toMatchObject({ kind: "auth" });
    await expect(client(new Response("", { status: 402 })).c.listModels()).rejects.toMatchObject({ kind: "balance" });
  });

  it("响应体不是 JSON（如被代理拦截）时给出带预览的错误", async () => {
    await expect(client(new Response("<html>gateway</html>")).c.listModels()).rejects.toMatchObject({
      kind: "invalid_json",
      preview: expect.stringContaining("gateway"),
    });
  });

  it("data 缺失时返回空列表而不是抛错", async () => {
    expect(await client(new Response("{}")).c.listModels()).toEqual([]);
  });
});
