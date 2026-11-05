import { regionName, type CountryRule } from "../countryRules";
import { makeFinding } from "../messages";
import type { Evidence, LetterOfCredit, PresentationRule } from "../model";

export const CARRIER_BL_ID = "UCP600-20-CARRIER-BL";

/** 信用证里要求承运人 / 船东签发提单、或不接受货代提单的常见写法。模式都有长度上限，避免回溯过深 */
const CLAUSES: RegExp[] = [
  /issued by (?:the )?(?:carrier|ship ?owner|vessel owner|steamship company|shipping company)/i,
  /(?:ship ?owner|carrier|shipping company)(?:'s|s)? (?:own )?(?:bill|b\/l)/i,
  /(?:forwarders?|nvocc|non[- ]vessel)\W{0,3}(?:s)?\W{0,3}(?:house )?(?:bills? of lading|b\/l)?.{0,40}not (?:be )?(?:acceptable|accepted|allowed)/i,
  /not accept(?:able|ed)?.{0,40}(?:forwarders?|nvocc|house)/i,
  /house (?:bills? of lading|b\/l).{0,30}not/i,
];

export function detectCarrierBlClause(lc: LetterOfCredit): { field: "46A" | "47A"; snippet: string } | null {
  for (const field of ["46A", "47A"] as const) {
    const text = lc.raw[field];
    if (!text) continue;
    const flat = text.replace(/\s+/g, " ");
    for (const re of CLAUSES) {
      const m = re.exec(flat);
      if (m) return { field, snippet: flat.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim() };
    }
  }
  return null;
}

export type IssuerKind = "carrier" | "forwarder" | "agent" | "unknown";

/** 按签发人 / 签发身份的文字做保守分类；只有明确出现承运人字样才算承运人 */
export function classifyIssuer(text: string): IssuerKind {
  if (/forwarders?|nvocc|non[- ]vessel/i.test(text)) return "forwarder";
  if (/agent/i.test(text)) return "agent";
  if (/\bcarrier\b|\bmaster\b|ship ?owner|\bowner\b/i.test(text)) return "carrier";
  return "unknown";
}

interface Source {
  zh: string;
  en: string;
  evidence: Evidence;
}

function sources(lc: LetterOfCredit, rules: CountryRule[]): Source[] {
  const out: Source[] = [];
  const clause = detectCarrierBlClause(lc);
  if (clause) out.push({ zh: "信用证条款", en: "L/C clause", evidence: { document: "lc", field: clause.field, value: clause.snippet } });
  const code = lc.issuingCountry;
  if (code && rules.some((r) => r.enabled && r.countryCode === code && r.requirements.includes("carrierBl"))) {
    out.push({
      zh: `国别规则（${regionName(code, "zh")}）`,
      en: `country rule (${regionName(code, "en")})`,
      evidence: { document: "manual", field: `country:${code}`, value: "carrierBl" },
    });
  }
  return out;
}

/** 审单：要求船东单（信用证条款或国别规则）时，核对提单的签发人 / 签发身份。结论最多是疑点，不判不符 */
export function buildCarrierBlRule(rules: CountryRule[]): PresentationRule {
  const clause = "UCP600 Art.20(a)";
  return {
    stage: "presentation",
    id: CARRIER_BL_ID,
    clause,
    title: "船东单（承运人签发提单）",
    // 没有任何要求时无需数据，直接通过；有要求但没有运输单据数据时记为「未检查」
    applicable: ({ lc, presentation }) => sources(lc, rules).length === 0 || !!presentation.transport,
    evaluate({ lc, presentation }) {
      const src = sources(lc, rules);
      if (src.length === 0) return [];
      const t = presentation.transport!;
      const issuer = [t.issuerName, t.signingCapacity].filter((s): s is string => !!s && s.trim() !== "").join(" / ");
      const kind = classifyIssuer(issuer);
      if (kind === "carrier") return [];
      return [
        makeFinding({
          ruleId: CARRIER_BL_ID,
          clause,
          severity: "doubt",
          code: kind === "forwarder" ? "carrierBl.forwarder" : "carrierBl.confirm",
          params: { sourceZh: src.map((s) => s.zh).join("、"), sourceEn: src.map((s) => s.en).join(", "), issuer: issuer || "—" },
          evidence: [...src.map((s) => s.evidence), { document: "transport", field: "issuer", value: issuer }],
        }),
      ];
    },
  };
}
