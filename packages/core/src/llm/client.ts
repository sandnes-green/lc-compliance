export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** 供业务层依赖的最小接口，便于替换服务商与测试。 */
export interface LlmClient {
  /** 请求模型返回 JSON 对象并解析；失败时抛出 LlmError */
  completeJson(messages: LlmMessage[]): Promise<unknown>;
  /** 列出该服务当前可用的模型 ID；不支持的实现可不提供 */
  listModels?(): Promise<string[]>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "balance" | "bad_request" | "rate_limit" | "server" | "network" | "empty" | "invalid_json" | "truncated",
    readonly status?: number,
    /** 模型原始返回内容的开头部分，仅用于排查（invalid_json 等） */
    readonly preview?: string,
  ) {
    super(message);
  }
}

const RESPONSE_LOG_MAX = 4000;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * 从模型返回中取出 JSON 对象。先按原样解析；失败时容忍常见的包装：
 * ```json 代码块围栏，或 JSON 前后夹带说明文字（取第一个 { 到最后一个 } 之间）。
 * 只接受对象，数组/标量视为无效。
 */
export function parseJsonObject(content: string): Record<string, unknown> | undefined {
  const tryParse = (t: string): Record<string, unknown> | undefined => {
    try {
      const v: unknown = JSON.parse(t);
      return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const text = content.trim();
  const direct = tryParse(text);
  if (direct) return direct;
  const fenced = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(text);
  if (fenced) {
    const v = tryParse(fenced[1]!);
    if (v) return v;
  }
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  return a >= 0 && b > a ? tryParse(text.slice(a, b + 1)) : undefined;
}

/** 发送记录（不含 API Key），用于本地「外发数据日志」 */
export interface LlmCallRecord {
  at: string;
  provider: string;
  model: string;
  messages: LlmMessage[];
  attempt: number;
  outcome: "ok" | LlmError["kind"];
  /** 模型返回内容（过长时截断），便于核对与排错 */
  response?: string;
}

export interface DeepSeekOptions {
  apiKey: string;
  /** 默认 https://api.deepseek.com */
  baseUrl?: string;
  /** 模型名会随官方版本变化，故可配置；默认 deepseek-flash */
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** 可重试错误（429/5xx/网络/空内容/JSON 非法）的最大重试次数 */
  maxRetries?: number;
  onCall?: (record: LlmCallRecord) => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

const RETRYABLE = new Set<LlmError["kind"]>(["rate_limit", "server", "network", "empty", "invalid_json"]);

async function httpError(res: Response): Promise<LlmError> {
  const s = res.status;
  const detail = (await res.text().catch(() => "")).slice(0, 300);
  if (s === 401) return new LlmError("API Key 无效", "auth", s);
  if (s === 402) return new LlmError("DeepSeek 账户余额不足", "balance", s);
  if (s === 429) return new LlmError("请求过于频繁", "rate_limit", s);
  if (s >= 500) return new LlmError(`服务端错误 ${s}`, "server", s);
  return new LlmError(`请求被拒绝 ${s}：${detail}`, "bad_request", s, detail);
}

export class DeepSeekClient implements LlmClient {
  private readonly o: Required<Omit<DeepSeekOptions, "onCall">> & Pick<DeepSeekOptions, "onCall">;

  constructor(options: DeepSeekOptions) {
    if (!options.apiKey) throw new LlmError("未配置 DeepSeek API Key", "auth");
    this.o = {
      baseUrl: "https://api.deepseek.com",
      model: DEFAULT_DEEPSEEK_MODEL,
      maxTokens: 4096,
      timeoutMs: 60_000,
      maxRetries: 2,
      fetchImpl: (...a) => fetch(...a),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      ...options,
    };
  }

  async completeJson(messages: LlmMessage[]): Promise<unknown> {
    // JSON 模式要求提示词中出现 "json" 字样，缺失时自动补一条系统提示
    const msgs = messages.some((m) => /json/i.test(m.content))
      ? messages
      : [{ role: "system" as const, content: "Respond with a valid JSON object only." }, ...messages];

    let last: LlmError | undefined;
    for (let attempt = 0; attempt <= this.o.maxRetries; attempt++) {
      try {
        const { value, raw } = await this.once(msgs);
        this.log(msgs, attempt, "ok", clip(raw, RESPONSE_LOG_MAX));
        return value;
      } catch (e) {
        const err = e instanceof LlmError ? e : new LlmError(String(e), "network");
        this.log(msgs, attempt, err.kind, err.preview);
        last = err;
        if (!RETRYABLE.has(err.kind) || attempt === this.o.maxRetries) break;
        await this.o.sleep(500 * 2 ** attempt);
      }
    }
    throw last!;
  }

  /** GET /models：返回当前 Key 可用的模型 ID（去重、排序） */
  async listModels(): Promise<string[]> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    let res: Response;
    try {
      res = await this.o.fetchImpl(`${this.o.baseUrl.replace(/\/$/, "")}/models`, {
        headers: { Authorization: `Bearer ${this.o.apiKey}` },
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new LlmError(`网络错误：${e instanceof Error ? e.message : String(e)}`, "network");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw await httpError(res);
    const text = await res.text();
    let body: { data?: { id?: unknown }[] };
    try {
      body = JSON.parse(text);
    } catch {
      throw new LlmError("服务返回的不是 JSON 响应", "invalid_json", res.status, text.slice(0, 300));
    }
    const ids = (body.data ?? []).map((m) => m?.id).filter((id): id is string => typeof id === "string" && id !== "");
    return [...new Set(ids)].sort();
  }

  private log(messages: LlmMessage[], attempt: number, outcome: LlmCallRecord["outcome"], response?: string) {
    this.o.onCall?.({ at: new Date().toISOString(), provider: "deepseek", model: this.o.model, messages, attempt, outcome, response });
  }

  private async once(messages: LlmMessage[]): Promise<{ value: unknown; raw: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    let res: Response;
    try {
      res = await this.o.fetchImpl(`${this.o.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify({
          model: this.o.model,
          messages,
          response_format: { type: "json_object" },
          max_tokens: this.o.maxTokens,
          temperature: 0,
          stream: false,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new LlmError(`网络错误：${e instanceof Error ? e.message : String(e)}`, "network");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw await httpError(res);

    const body = await res.text();
    let data: { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
    try {
      data = JSON.parse(body);
    } catch {
      // 200 却不是 JSON：多半是代理/网关返回的网页
      throw new LlmError("服务返回的不是 JSON 响应（可能被代理或网关拦截）", "invalid_json", res.status, clip(body, 300));
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (choice?.finish_reason === "length") throw new LlmError("输出被截断，请缩短输入或增大 maxTokens", "truncated", undefined, clip(content ?? "", 300));
    if (!content) throw new LlmError("模型返回空内容", "empty", undefined, `finish_reason=${choice?.finish_reason ?? "?"}`);
    const value = parseJsonObject(content);
    if (value === undefined) throw new LlmError("模型返回的不是合法 JSON 对象", "invalid_json", undefined, clip(content, 300));
    return { value, raw: content };
  }
}
