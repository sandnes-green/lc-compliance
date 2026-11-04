/**
 * 自定义检查项：由公司内部审单清单、客户要求等手册提炼而来（或用户手工添加）。
 *
 * text    文字包含/不含：在单据原文里确定性地查关键词，结果可信
 * ai      AI 判断：交给大模型判断单据是否满足要求，结果不确定，最多算「疑点」
 * manual  人工核对：软件无法检查，只做提醒
 */
export type CheckKind = "text" | "ai" | "manual";
export type CheckScope = "lc" | "invoice" | "transport" | "insurance";
export type CheckStatus = "candidate" | "enabled" | "disabled";
export type CheckSeverity = "discrepancy" | "doubt" | "info";

export const CHECK_KINDS: readonly CheckKind[] = ["text", "ai", "manual"];
export const CHECK_SCOPES: readonly CheckScope[] = ["lc", "invoice", "transport", "insurance"];
export const CHECK_SEVERITIES: readonly CheckSeverity[] = ["discrepancy", "doubt", "info"];

/** all：每个词都必须出现；any：至少出现一个；none：一个都不能出现 */
export interface TextMatch {
  mode: "all" | "any" | "none";
  phrases: string[];
}

export interface CheckItemSource {
  manualId: string | null;
  manualName: string;
  /** 手册原文中的依据（逐字摘录） */
  quote: string;
}

export interface CheckItem {
  id: string;
  title: string;
  requirement: string;
  kind: CheckKind;
  scope: CheckScope;
  severity: CheckSeverity;
  textMatch?: TextMatch;
  /** 来自哪份手册；用户手工添加的为 null */
  source: CheckItemSource | null;
  status: CheckStatus;
  origin: "ai" | "user";
  createdAt: string;
  updatedAt: string;
}

/** 不含 id/状态/时间的内容部分，创建与编辑时使用 */
export interface CheckItemDraft {
  title: string;
  requirement: string;
  kind: CheckKind;
  scope: CheckScope;
  severity: CheckSeverity;
  textMatch?: TextMatch;
}

export const MAX_TITLE = 120;
export const MAX_REQUIREMENT = 800;
export const MAX_PHRASES = 8;
export const MAX_PHRASE_LEN = 120;

export type DraftError = "title" | "requirement" | "kind" | "scope" | "severity" | "phrases";

/** 比较用规范化：忽略大小写，所有空白（含换行）合并为一个空格 */
export const normText = (s: string): string => s.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

function parseTextMatch(raw: unknown): TextMatch | null {
  const o = raw as { mode?: unknown; phrases?: unknown } | null | undefined;
  if (!o || !oneOf(["all", "any", "none"] as const, o.mode) || !Array.isArray(o.phrases)) return null;
  const phrases = [...new Set(o.phrases.filter((p): p is string => typeof p === "string").map((p) => p.trim()).filter(Boolean))];
  if (phrases.length === 0 || phrases.length > MAX_PHRASES || phrases.some((p) => p.length > MAX_PHRASE_LEN)) return null;
  return { mode: o.mode, phrases };
}

/**
 * 校验并规范化检查项内容（来自 AI 提炼或用户编辑，一律不可信）。
 * downgradeInvalidText：AI 提炼时，若「文字」类缺少有效关键词，降级为「AI 判断」而不是丢弃。
 */
export function parseCheckItemDraft(raw: unknown, opts: { downgradeInvalidText?: boolean } = {}): { ok: true; draft: CheckItemDraft } | { ok: false; error: DraftError } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const requirement = typeof o.requirement === "string" ? o.requirement.trim() : "";
  if (title === "" || title.length > MAX_TITLE) return { ok: false, error: "title" };
  if (requirement === "" || requirement.length > MAX_REQUIREMENT) return { ok: false, error: "requirement" };
  if (!oneOf(CHECK_KINDS, o.kind)) return { ok: false, error: "kind" };
  if (!oneOf(CHECK_SCOPES, o.scope)) return { ok: false, error: "scope" };
  if (!oneOf(CHECK_SEVERITIES, o.severity)) return { ok: false, error: "severity" };

  let kind: CheckKind = o.kind;
  let textMatch: TextMatch | undefined;
  if (kind === "text") {
    textMatch = parseTextMatch(o.textMatch) ?? undefined;
    if (!textMatch) {
      if (!opts.downgradeInvalidText) return { ok: false, error: "phrases" };
      kind = "ai";
    }
  }
  return { ok: true, draft: { title, requirement, kind, scope: o.scope, severity: o.severity, ...(kind === "text" ? { textMatch } : {}) } };
}

export interface TextMatchResult {
  ok: boolean;
  /** all：缺少的词；any：全部候选词；none：出现了的禁用词 */
  phrases: string[];
}

/** 在文字里按规则查关键词。不满足时 phrases 给出缺失（或违规出现）的词 */
export function matchText(text: string, m: TextMatch): TextMatchResult {
  const hay = normText(text);
  const present = m.phrases.filter((p) => hay.includes(normText(p)));
  if (m.mode === "all") {
    const missing = m.phrases.filter((p) => !present.includes(p));
    return { ok: missing.length === 0, phrases: missing };
  }
  if (m.mode === "any") return { ok: present.length > 0, phrases: m.phrases };
  return { ok: present.length === 0, phrases: present };
}
