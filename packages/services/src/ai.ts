import { AppError, DEFAULT_DEEPSEEK_MODEL, DeepSeekClient, extractFields, redact } from "@lc/core";
import type { DeepSeekOptions, ExtractionResult, LlmClient } from "@lc/core";
import type { CaseStore } from "@lc/storage";

export const DEFAULT_MODEL = DEFAULT_DEEPSEEK_MODEL;
/** 设置页下拉里始终提供的候选；实际可用模型以 listModels() 从服务端获取为准 */
export const PRESET_MODELS = ["deepseek-flash", "deepseek-chat", "deepseek-reasoner"] as const;
/** 单据正文超过该长度不外发（正常的发票/提单远小于此值） */
export const MAX_SEND_CHARS = 60_000;

/** 密钥加解密（由 Electron 的 safeStorage / Windows DPAPI 提供，测试中可替换） */
export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(encrypted: string): string;
}

export interface AiSettings {
  enabled: boolean;
  hasKey: boolean;
  model: string;
  redact: boolean;
  consentAt: string | null;
  /** 下拉里始终提供的候选模型 */
  presetModels: readonly string[];
  /** 企业策略禁止使用外部 AI：此时 enabled 恒为 false，且无法启用 */
  blockedByPolicy: boolean;
}

export interface AiSettingsInput {
  enabled?: boolean;
  /** string：设置新密钥；null：清除密钥；缺省：不变 */
  apiKey?: string | null;
  model?: string;
  redact?: boolean;
  /** 用户已确认「单据文字将发送至 DeepSeek」；首次启用时必须为 true */
  consent?: boolean;
}

export type ClientFactory = (options: DeepSeekOptions) => LlmClient;

const K = { enabled: "ai.enabled", key: "ai.keyEnc", model: "ai.model", redact: "ai.redact", consent: "ai.consentAt" } as const;

export class AiService {
  constructor(
    private readonly store: CaseStore,
    private readonly secrets: SecretBox,
    private readonly makeClient: ClientFactory = (o) => new DeepSeekClient(o),
    /** 企业策略是否允许使用外部 AI；返回 false 时所有外发功能被锁定 */
    private readonly isAllowed: () => boolean = () => true,
  ) {}

  getSettings(): AiSettings {
    const allowed = this.isAllowed();
    return {
      // 策略禁止时，即使库里曾经启用过也视为未启用
      enabled: allowed && this.store.getSetting(K.enabled) === "1",
      blockedByPolicy: !allowed,
      hasKey: this.store.getSetting(K.key) !== null,
      model: this.store.getSetting(K.model) ?? DEFAULT_MODEL,
      // 脱敏默认开启
      redact: this.store.getSetting(K.redact) !== "0",
      consentAt: this.store.getSetting(K.consent),
      presetModels: PRESET_MODELS,
    };
  }

  save(input: AiSettingsInput): AiSettings {
    if (input.model !== undefined && !/^[\w.:-]{1,64}$/.test(input.model)) {
      throw new AppError("ai.invalidModel", "模型名称无效", {});
    }
    if (typeof input.apiKey === "string" && input.apiKey.trim() === "") {
      throw new AppError("ai.invalidKey", "API Key 不能为空", {});
    }

    if (input.enabled === true && !this.isAllowed()) throw new AppError("ai.blockedByPolicy", "管理员策略禁止使用外部 AI", {});
    const cur = this.getSettings();
    if (input.enabled === true && !cur.enabled) {
      if (input.consent === true) this.store.setSetting(K.consent, new Date().toISOString());
      else if (!cur.consentAt) throw new AppError("ai.consentRequired", "启用前需确认同意将单据文字发送至外部模型", {});
    }

    if (input.apiKey === null) this.store.deleteSetting(K.key);
    else if (typeof input.apiKey === "string") this.store.setSetting(K.key, this.secrets.encrypt(input.apiKey.trim()));
    if (input.enabled !== undefined) this.store.setSetting(K.enabled, input.enabled ? "1" : "0");
    if (input.model !== undefined) this.store.setSetting(K.model, input.model);
    if (input.redact !== undefined) this.store.setSetting(K.redact, input.redact ? "1" : "0");

    const next = this.getSettings();
    // 审计只记录开关与是否有密钥，绝不记录密钥本身
    this.store.logEvent("settings.ai", { enabled: next.enabled, hasKey: next.hasKey, model: next.model, redact: next.redact });
    return next;
  }

  /** 构造客户端；未配置密钥（或要求启用而未启用）时抛出带编码的错误 */
  private client(caseId: string | null, requireEnabled = true): LlmClient {
    // 策略禁止时，任何会联网的功能（含获取模型列表）都不可用
    if (!this.isAllowed()) throw new AppError("ai.blockedByPolicy", "管理员策略禁止使用外部 AI", {});
    const s = this.getSettings();
    if (requireEnabled && !s.enabled) throw new AppError("ai.disabled", "AI 功能未启用", {});
    const enc = this.store.getSetting(K.key);
    if (!enc) throw new AppError("ai.noKey", "未配置 API Key", {});
    return this.makeClient({ apiKey: this.secrets.decrypt(enc), model: s.model, onCall: (r) => this.store.logLlmCall(r, caseId) });
  }

  /**
   * 供手册提炼、AI 判断等功能使用：返回已启用的模型客户端，未启用/无密钥时抛出带编码的错误。
   * 所有外发请求都经这里，因此都会进入外发日志。
   */
  llm(caseId: string | null): LlmClient {
    return this.client(caseId);
  }

  /** 外发前处理文字：按设置脱敏（金额、日期、货描不处理） */
  prepareOutbound(text: string): string {
    return this.getSettings().redact ? redact(text) : text;
  }

  /**
   * 从服务端获取可用模型列表，供设置页下拉选择。
   * 选模型通常发生在启用之前，故只要求已保存密钥；该请求不含任何单据内容。
   */
  async listModels(): Promise<string[]> {
    const client = this.client(null, false);
    if (!client.listModels) throw new AppError("ai.modelsUnsupported", "当前服务不支持获取模型列表", {});
    return client.listModels();
  }

  /** 连通性测试：发送一条极短的请求，同样会进入外发日志 */
  async test(): Promise<void> {
    await this.client(null).completeJson([
      { role: "system", content: "You are a connectivity probe. Respond with a single JSON object and nothing else." },
      { role: "user", content: 'Return the JSON object {"ok": true}.' },
    ]);
  }

  /** 对一份已导入的单据做 AI 抽取并保存结果（结果仍须由用户校对后才进入审查） */
  async extract(documentId: string): Promise<ExtractionResult> {
    const { caseId, docType, text } = this.store.getDocumentText(documentId);
    if (text.length > MAX_SEND_CHARS) {
      throw new AppError("doc.tooLong", `单据文字过长（${text.length} 字符，上限 ${MAX_SEND_CHARS}）`, { chars: text.length, max: MAX_SEND_CHARS });
    }
    const client = this.client(caseId);
    // 引用校验针对实际发出的文本（脱敏后）；金额、日期、币种不在脱敏范围内
    const sent = this.getSettings().redact ? redact(text) : text;
    const result = await extractFields(client, docType, sent);
    this.store.saveExtraction(documentId, result);
    return result;
  }
}
