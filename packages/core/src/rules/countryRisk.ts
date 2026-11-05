import { REQUIREMENT_LABELS, regionName, type CountryRule } from "../countryRules";
import { makeFinding } from "../messages";
import type { LcRule } from "../model";

export const COUNTRY_RISK_ID = "LCR-COUNTRY-RISK";

/** 审证：按开证行所在国家，把国别规则表里的要求列给用户。只是提醒或风险提示，不是单据不符点 */
export function buildCountryRiskRule(rules: CountryRule[]): LcRule {
  const active = rules.filter((r) => r.enabled);
  const clause = "Internal country policy";
  return {
    stage: "lc",
    id: COUNTRY_RISK_ID,
    clause,
    title: "国别风险提示",
    evaluate({ lc }) {
      if (active.length === 0) return [];
      if (!lc.issuingCountry) {
        return [
          makeFinding({
            ruleId: COUNTRY_RISK_ID,
            clause,
            severity: "info",
            code: "country.unknown",
            params: {},
            evidence: [{ document: "lc", field: "52A", value: lc.raw["52A"] ?? "" }],
          }),
        ];
      }
      return active
        .filter((r) => r.countryCode === lc.issuingCountry)
        .map((r) =>
          makeFinding({
            ruleId: COUNTRY_RISK_ID,
            clause,
            severity: r.level === "high" ? "risk" : "info",
            code: "country.hit",
            params: {
              country: r.countryCode,
              countryZh: regionName(r.countryCode, "zh"),
              countryEn: regionName(r.countryCode, "en"),
              reqZh: r.requirements.map((q) => REQUIREMENT_LABELS[q].zh).join("；") || "（未勾选具体要求）",
              reqEn: r.requirements.map((q) => REQUIREMENT_LABELS[q].en).join("; ") || "(no specific requirement ticked)",
              stateZh: r.reviewed ? "" : "（待审核）",
              stateEn: r.reviewed ? "" : " (pending review)",
              note: r.note,
            },
            evidence: [
              { document: "lc", field: "52A", value: lc.issuingBankBic ?? "" },
              { document: "manual", field: `country:${r.countryCode}`, value: r.note || r.requirements.join(",") },
            ],
          }),
        );
    },
  };
}
