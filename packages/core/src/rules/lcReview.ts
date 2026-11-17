import { diffDays } from "../dates";
import { makeFinding } from "../messages";
import { regionName } from "../countryRules";
import { countryFromText } from "../mt700";
import type { Finding, LcRule, LetterOfCredit } from "../model";

/**
 * 审证：出口商在收到信用证后、备货发运前应检查的事项。
 * 这里的发现多为「风险」，是需要在发运前与申请人/开证行沟通修改的条款，而不是单据不符点。
 */

/** 有效期与最迟装运日的关系：装运后必须还有足够时间交单 */
export const expiryVsShipment: LcRule = {
  stage: "lc",
  id: "LCR-EXPIRY-VS-SHIPMENT",
  clause: "UCP600 Art.6(d), Art.14(c)",
  title: "有效期与最迟装运日",
  evaluate({ lc }) {
    if (!lc.expiryDate || !lc.latestShipmentDate) return [];
    const days = lc.presentationDays ?? 21;
    const evidence = [
      { document: "lc" as const, field: "31D", value: lc.expiryDate },
      { document: "lc" as const, field: "44C", value: lc.latestShipmentDate },
    ];
    if (lc.expiryDate < lc.latestShipmentDate) {
      return [
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity: "risk",
          code: "lc.expiryBeforeShipment",
          params: { expiry: lc.expiryDate, latest: lc.latestShipmentDate },
          evidence,
        }),
      ];
    }
    const window = diffDays(lc.expiryDate, lc.latestShipmentDate);
    if (window < days) {
      return [
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity: "risk",
          code: "lc.shortWindow",
          params: { expiry: lc.expiryDate, latest: lc.latestShipmentDate, window, days },
          evidence,
        }),
      ];
    }
    // 公司审证指令：有效期与最迟装运日至少相隔 POLICY_MIN_GAP_DAYS 天（即使 48 的交单期更短）
    if (window < POLICY_MIN_GAP_DAYS) {
      return [
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity: "risk",
          code: "lc.shortWindowPolicy",
          params: { expiry: lc.expiryDate, latest: lc.latestShipmentDate, window, min: POLICY_MIN_GAP_DAYS },
          evidence,
        }),
      ];
    }
    return [];
  },
};

/** 公司审证指令：有效期（valid date）与最迟装运日（latest shipment date）至少相隔的天数 */
export const POLICY_MIN_GAP_DAYS = 21;

/** 信用证没有 41a 时在提示里的写法 */
const NO_41A = "no 41a";

/**
 * 信用证在开证行兑用：41a 写的是开证行本身（"ISSUING BANK"，或 41A 的 BIC 就是开证行）；
 * 或者整份信用证没有 41a —— 这类信用证的承兑 / 付款行就是开证行，单据最终要交给开证行。
 */
function availableWithIssuer(lc: LetterOfCredit): boolean {
  if (!lc.raw["41A"] && !lc.raw["41D"]) return true;
  const v = (lc.raw["41A"] ?? lc.raw["41D"] ?? "").toUpperCase();
  if (/\bISSUING\s+BANK\b|\bISSUER\b|\bOURSELVES\b|\bOUR\s+COUNTERS?\b/.test(v)) return true;
  const bic = lc.issuingBankBic?.slice(0, 8);
  return !!bic && v.replace(/\s+/g, "").includes(bic);
}

/**
 * 到期地点（31D）：单据须在有效期当天或之前送达「到期地点的指定银行」（UCP600 6(d)(ii)）。
 * 指定银行由 41a 决定：ANY BANK / 某家银行时，向到期地点的该行交单，由它寄单给开证行；
 * 41a 指定开证行本身时，单据须在有效期内寄到开证行——此时到期地点若不在开证行所在国家，条款自相矛盾。
 */
export const expiryPlace: LcRule = {
  stage: "lc",
  id: "LCR-EXPIRY-PLACE",
  clause: "UCP600 Art.6(a), Art.6(d)",
  title: "到期地点",
  evaluate({ lc }) {
    if (!lc.expiryPlace) return [];
    const avail = (lc.raw["41A"] ?? lc.raw["41D"] ?? "").replace(/\s+/g, " ").trim() || NO_41A;
    const evidence = [
      { document: "lc" as const, field: "31D", value: `${lc.expiryDate ?? ""} ${lc.expiryPlace}`.trim() },
      ...(avail !== NO_41A ? [{ document: "lc" as const, field: lc.raw["41A"] ? "41A" : "41D", value: avail }] : []),
      ...(lc.latestShipmentDate ? [{ document: "lc" as const, field: "44C", value: lc.latestShipmentDate }] : []),
    ];
    const gap = lc.expiryDate && lc.latestShipmentDate && lc.expiryDate >= lc.latestShipmentDate ? diffDays(lc.expiryDate, lc.latestShipmentDate) : undefined;
    const params = {
      place: lc.expiryPlace,
      expiry: lc.expiryDate ?? "-",
      availZh: avail === NO_41A ? "无 41a，承兑行即开证行" : avail,
      availEn: avail === NO_41A ? "no field 41a, so the accepting bank is the issuing bank" : avail,
      gapZh: gap === undefined ? "" : `最迟装运日 ${lc.latestShipmentDate} 到有效期相隔 ${gap} 天（公司要求至少 ${POLICY_MIN_GAP_DAYS} 天）。`,
      gapEn: gap === undefined ? "" : ` The latest shipment date ${lc.latestShipmentDate} is ${gap} day(s) before expiry (company minimum: ${POLICY_MIN_GAP_DAYS}).`,
    };
    const placeCountry = countryFromText(lc.expiryPlace);
    if (availableWithIssuer(lc)) {
      // 在开证行兑用，到期地点却写在别的国家：交单地点与到期地点冲突，须改证
      const conflict = !!placeCountry && !!lc.issuingCountry && placeCountry !== lc.issuingCountry;
      return [
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity: conflict ? "doubt" : "info",
          code: conflict ? "lc.expiryPlace.issuerConflict" : "lc.expiryPlace.issuer",
          params: {
            ...params,
            country: lc.issuingCountry ?? "-",
            countryZh: lc.issuingCountry ? regionName(lc.issuingCountry, "zh") : "开证行所在国",
            countryEn: lc.issuingCountry ? regionName(lc.issuingCountry, "en") : "the issuing bank's country",
          },
          evidence,
        }),
      ];
    }
    return [
      makeFinding({
        ruleId: this.id,
        clause: this.clause,
        severity: "info",
        code: "lc.expiryPlace",
        params,
        evidence,
      }),
    ];
  },
};

interface SoftPattern {
  code: string;
  re: RegExp;
}

const WHO = String.raw`(?:THE\s+)?(?:APPLICANT|BUYER|OPENER|IMPORTER)`;

/** 常见软条款（取决于申请人行为、使受益人无法自行满足的条款）的特征句式 */
const SOFT_PATTERNS: SoftPattern[] = [
  { code: "lc.soft.applicantDoc", re: new RegExp(String.raw`(?:ISSUED|SIGNED|COUNTERSIGNED|CERTIFIED|ENDORSED|CONFIRMED)\s+BY\s+${WHO}`) },
  { code: "lc.soft.applicantDoc", re: new RegExp(String.raw`${WHO}['’]?S?\s+(?:SIGNATURE|SIGNED|COUNTERSIGN)`) },
  { code: "lc.soft.applicantApproval", re: new RegExp(String.raw`(?:APPROVAL|CONSENT|ACCEPTANCE|AGREEMENT|CONFIRMATION)\s+(?:OF|BY|FROM)\s+${WHO}`) },
  { code: "lc.soft.applicantApproval", re: new RegExp(String.raw`SUBJECT\s+TO\s+${WHO}['’]?S?\s+(?:APPROVAL|CONSENT|ACCEPTANCE)`) },
  { code: "lc.soft.conditionalEffect", re: /(?:CREDIT|L\/C)\s+(?:WILL\s+)?(?:BE|BECOMES?|IS)\s+(?:EFFECTIVE|OPERATIVE|VALID)\s+(?:ONLY\s+)?(?:AFTER|UPON|WHEN|ON\s+RECEIPT)/ },
  { code: "lc.soft.laterAdvice", re: new RegExp(String.raw`(?:SHIPPING\s+(?:MARKS|INSTRUCTIONS?)|NAME\s+OF\s+(?:THE\s+)?VESSEL|VESSEL\s+NAME|SHIPMENT\s+DATE)[^+]{0,60}?(?:TO\s+BE|WILL\s+BE|SHALL\s+BE)\s+(?:ADVISED|NOTIFIED|NOMINATED|DESIGNATED|SPECIFIED)\s+(?:BY|FROM)\s+${WHO}`) },
  { code: "lc.soft.applicantInspection", re: new RegExp(String.raw`INSPECTION\s+(?:CERTIFICATE|REPORT)[^+]{0,80}?${WHO}`) },
];

const snippet = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

/** 软条款识别：关键词启发式，只提示「疑似」，最终须由人工结合业务判断 */
export const softClauses: LcRule = {
  stage: "lc",
  id: "LCR-SOFT-CLAUSES",
  clause: "Risk review: soft clauses",
  title: "疑似软条款",
  evaluate({ lc }) {
    const sources: [string, string | undefined][] = [
      ["46A", lc.documentsRequired],
      ["47A", lc.additionalConditions],
      ["45A", lc.goodsDescription],
    ];
    const out: Finding[] = [];
    for (const [field, text] of sources) {
      if (!text) continue;
      const upper = text.toUpperCase();
      // 同一句话可能被多条模式命中（范围重叠），只报先命中的一条；同一模式在文中多处出现则各报一次
      const taken: [number, number][] = [];
      for (const { code, re } of SOFT_PATTERNS) {
        for (const m of upper.matchAll(new RegExp(re.source, "g"))) {
          const start = m.index;
          const end = start + m[0].length;
          if (taken.some(([a, b]) => start < b && a < end)) continue;
          taken.push([start, end]);
          const original = snippet(text.slice(start, end));
          out.push(
            makeFinding({
              ruleId: this.id,
              clause: this.clause,
              severity: "risk",
              code,
              params: { snippet: original },
              evidence: [{ document: "lc", field, value: original }],
            }),
          );
        }
      }
    }
    return out;
  },
};

export const lcReviewRules: LcRule[] = [expiryVsShipment, softClauses, expiryPlace];
