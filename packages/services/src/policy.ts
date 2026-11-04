/**
 * 企业策略：由管理员放在机器级位置（%ProgramData%\LCCompliance\policy.json）的配置，
 * 约束或预设应用行为。普通用户在应用内无法修改。
 *
 * {
 *   "update": { "enabled": true, "feedUrl": "https://updates.corp.example/lc/", "autoCheck": true },
 *   "ai":     { "allowed": true }
 * }
 */
export interface Policy {
  update: {
    enabled: boolean;
    /** 更新源（目录 URL，内含 latest.yml 与安装包）；未配置则不检查更新 */
    feedUrl: string | null;
    autoCheck: boolean;
  };
  ai: {
    /** false：禁止使用外部 AI（单据文字不会外发），设置页对应开关锁定 */
    allowed: boolean;
  };
}

export const DEFAULT_POLICY: Policy = {
  update: { enabled: true, feedUrl: null, autoCheck: true },
  ai: { allowed: true },
};

export type PolicyWarning = { code: "invalidJson" | "invalidField"; field?: string };

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "[::1]";

/**
 * 更新源必须是 HTTPS（防止明文传输被中间人替换安装包）。
 * allowLocalHttp 仅用于开发/测试：允许 http 的本机地址。
 */
export function isAllowedFeedUrl(raw: string, opts: { allowLocalHttp?: boolean } = {}): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false; // 不允许把凭据写在 URL 里
  if (u.protocol === "https:") return true;
  return u.protocol === "http:" && !!opts.allowLocalHttp && isLocalHost(u.hostname);
}

/** 解析策略文件内容。任何一处无效都只忽略那一项（回到默认），并给出警告；绝不因为策略文件写错而让应用无法启动 */
export function parsePolicy(text: string | null, opts: { allowLocalHttp?: boolean } = {}): { policy: Policy; warnings: PolicyWarning[] } {
  const policy: Policy = { update: { ...DEFAULT_POLICY.update }, ai: { ...DEFAULT_POLICY.ai } };
  const warnings: PolicyWarning[] = [];
  if (text === null) return { policy, warnings };

  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { policy, warnings: [{ code: "invalidJson" }] };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { policy, warnings: [{ code: "invalidJson" }] };
  const o = raw as Record<string, unknown>;

  const section = (name: string): Record<string, unknown> | null => {
    const v = o[name];
    if (v === undefined) return null;
    if (v === null || typeof v !== "object" || Array.isArray(v)) {
      warnings.push({ code: "invalidField", field: name });
      return null;
    }
    return v as Record<string, unknown>;
  };
  const bool = (sec: Record<string, unknown>, key: string, name: string, set: (v: boolean) => void) => {
    if (sec[key] === undefined) return;
    if (typeof sec[key] === "boolean") set(sec[key] as boolean);
    else warnings.push({ code: "invalidField", field: `${name}.${key}` });
  };

  const upd = section("update");
  if (upd) {
    bool(upd, "enabled", "update", (v) => (policy.update.enabled = v));
    bool(upd, "autoCheck", "update", (v) => (policy.update.autoCheck = v));
    if (upd.feedUrl !== undefined && upd.feedUrl !== null) {
      if (typeof upd.feedUrl === "string" && isAllowedFeedUrl(upd.feedUrl, opts)) policy.update.feedUrl = upd.feedUrl;
      else warnings.push({ code: "invalidField", field: "update.feedUrl" });
    }
  }
  const ai = section("ai");
  if (ai) bool(ai, "allowed", "ai", (v) => (policy.ai.allowed = v));
  return { policy, warnings };
}
