import { diffDays } from "../dates";
import { makeFinding } from "../messages";
import type { Finding, LcRule } from "../model";

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
    return [];
  },
};

/** 到期地点：须在到期日前把单据送达该地的银行，境外到期要预留寄单时间 */
export const expiryPlace: LcRule = {
  stage: "lc",
  id: "LCR-EXPIRY-PLACE",
  clause: "UCP600 Art.6(a), Art.6(d)(i)",
  title: "到期地点",
  evaluate({ lc }) {
    if (!lc.expiryPlace) return [];
    return [
      makeFinding({
        ruleId: this.id,
        clause: this.clause,
        severity: "info",
        code: "lc.expiryPlace",
        params: { place: lc.expiryPlace, expiry: lc.expiryDate ?? "-" },
        evidence: [{ document: "lc", field: "31D", value: `${lc.expiryDate ?? ""} ${lc.expiryPlace}`.trim() }],
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
