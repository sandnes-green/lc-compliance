import { REQUIREMENT_LABELS, regionName, type CountryRule } from "../countryRules";
import { makeFinding } from "../messages";
import type { LcRule } from "../model";

export const COUNTRY_RISK_ID = "LCR-COUNTRY-RISK";

/** 国家来源在证据表里显示的字段名 */
const SOURCE_FIELD = { "52A": "52A", "52D": "52D", header: "Sender", applicant: "50" } as const;

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
            evidence: lc.raw["52A"] ? [{ document: "lc", field: "52A", value: lc.raw["52A"] }] : lc.raw["52D"] ? [{ document: "lc", field: "52D", value: lc.raw["52D"] }] : [],
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
              viaZh: lc.issuingCountrySource === "applicant" ? "（信用证未写明开证行，按申请人地址推断）" : lc.issuingCountrySource === "header" ? "（取自报文头的发送行）" : "",
              viaEn: lc.issuingCountrySource === "applicant" ? " (no issuing bank field; inferred from the applicant's address)" : lc.issuingCountrySource === "header" ? " (from the message sender in the header)" : "",
            },
            evidence: [
              {
                document: "lc",
                field: SOURCE_FIELD[lc.issuingCountrySource ?? "52A"],
                value: lc.issuingCountrySource === "applicant" ? (lc.applicant ?? "").replace(/\s+/g, " ").trim() : (lc.issuingBankBic ?? lc.raw["52D"] ?? lc.raw["52A"] ?? ""),
              },
              {
                document: "policy",
                field: `country:${r.countryCode}`,
                value: r.note || r.requirements.map((q) => `${REQUIREMENT_LABELS[q].zh} / ${REQUIREMENT_LABELS[q].en}`).join("；") || "—",
              },
            ],
          }),
        );
    },
  };
}
