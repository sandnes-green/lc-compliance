import type { Lang } from "./messages";

/** 可被机器核对的要求事项；其余内容写在自由备注里，只显示给人看 */
export type CountryRequirement = "carrierBl" | "fullSetBl" | "noTranshipment" | "confirmation";
export const COUNTRY_REQUIREMENTS: readonly CountryRequirement[] = ["carrierBl", "fullSetBl", "noTranshipment", "confirmation"];

export const REQUIREMENT_LABELS: Record<CountryRequirement, Record<Lang, string>> = {
  carrierBl: { zh: "必须船东单（承运人签发的提单）", en: "Carrier-issued bill of lading required" },
  fullSetBl: { zh: "需全套正本提单", en: "Full set of original bills of lading required" },
  noTranshipment: { zh: "禁止转运", en: "No transhipment" },
  confirmation: { zh: "建议保兑", en: "Confirmation recommended" },
};

export type CountryLevel = "notice" | "high";

export interface CountryRuleDraft {
  /** ISO 3166-1 alpha-2，大写；与开证行 BIC 第 5、6 位对应 */
  countryCode: string;
  level: CountryLevel;
  requirements: CountryRequirement[];
  note: string;
  enabled: boolean;
  /** 是否已由单证专业人员审核；未审核的提示会带“待审核”字样 */
  reviewed: boolean;
}

export interface CountryRule extends CountryRuleDraft {
  id: string;
}

const MAX_NOTE = 2000;

export function parseCountryRuleDraft(raw: unknown): { ok: true; draft: CountryRuleDraft } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "root" };
  const o = raw as Record<string, unknown>;
  const code = typeof o.countryCode === "string" ? o.countryCode.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(code)) return { ok: false, error: "countryCode" };
  if (o.level !== "notice" && o.level !== "high") return { ok: false, error: "level" };
  if (!Array.isArray(o.requirements) || !o.requirements.every((r) => COUNTRY_REQUIREMENTS.includes(r as CountryRequirement))) return { ok: false, error: "requirements" };
  if (typeof o.note !== "string" || o.note.length > MAX_NOTE) return { ok: false, error: "note" };
  if (typeof o.enabled !== "boolean") return { ok: false, error: "enabled" };
  if (typeof o.reviewed !== "boolean") return { ok: false, error: "reviewed" };
  return {
    ok: true,
    draft: {
      countryCode: code,
      level: o.level,
      requirements: [...new Set(o.requirements as CountryRequirement[])],
      note: o.note,
      enabled: o.enabled,
      reviewed: o.reviewed,
    },
  };
}

/** 起步清单：只放已经确认的内容，并标为未审核。其余由用户自行增补 */
export const STARTER_COUNTRY_RULES: CountryRuleDraft[] = [
  { countryCode: "BD", level: "notice", requirements: ["carrierBl"], note: "起步示例，待单证人员审核：该国信用证常要求提交船东单。", enabled: true, reviewed: false },
  { countryCode: "TR", level: "notice", requirements: ["carrierBl"], note: "起步示例，待单证人员审核：该国信用证常要求提交船东单。", enabled: true, reviewed: false },
];

/** 国家代码 → 本地化国家名；运行环境不支持或代码未知时回退为代码 */
export function regionName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang === "zh" ? "zh-Hans" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
