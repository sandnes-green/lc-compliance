import { REQUIREMENT_LABELS, regionName, type CountryRule } from "../countryRules";
import { makeFinding } from "../messages";
import type { Evidence, LetterOfCredit, PresentationRule } from "../model";

export const CARRIER_BL_ID = "UCP600-20-CARRIER-BL";

/** 撇号：ASCII ' 与弯引号 ’ 都接受 */
const AP = "['’]";
const BL = String.raw`(?:bills? of lading|b\/l)`;
const FWD = String.raw`(?:forward(?:er|ers)|nvocc|non[- ]vessel(?: operating)?)`;
const OK = String.raw`(?:acceptable|accepted|allowed|permitted)`;

interface Clause {
  re: RegExp;
  /** 肯定式要求（“须由承运人签发”）：同一小句里出现 not / no 时视为被否定，不算命中 */
  negatable: boolean;
}

/** 信用证里要求承运人 / 船东签发提单、或不接受货代提单的常见写法。量词都有上限，避免回溯过深；有歧义时宁可不匹配 */
const CLAUSES: Clause[] = [
  // 须由承运人 / 船东 / 船公司签发
  {
    re: new RegExp(
      String.raw`\b(?:issued|signed) by (?:the )?(?:(?:actual|ocean|shipping|named) )?(?:carrier|ship ?owner|vessel owner|steamship company|shipping (?:company|line))\b(?!\W{0,3}${BL}?\W{0,3}(?:no\b|number|nr\b))`,
      "gi",
    ),
    negatable: true,
  },
  // 承运人 / 船东自己的提单；“NAME OF CARRIER B/L NUMBER”之类不是条款
  {
    re: new RegExp(
      String.raw`(?<!name of (?:the )?)\b(?:ship ?owner|carrier|shipping (?:company|line))(?:${AP}?s)? (?:own )?${BL}(?!\s{0,2}(?:no\b|number|nr\b))`,
      "gi",
    ),
    negatable: true,
  },
  // 货代 / NVOCC / 分提单（house）不可接受
  {
    re: new RegExp(
      String.raw`\b(?:(?:freight )?${FWD}(?:${AP}?s)?(?: ${BL})?|house(?:${AP}?s)? ${BL})(?: (?:is|are|shall be|will be|to be|must be))? (?:not (?:be )?|un)${OK}\b`,
      "gi",
    ),
    negatable: false,
  },
  // “NO B/L ISSUED BY FORWARDER IS ACCEPTABLE”
  {
    re: new RegExp(
      String.raw`\bno ${BL}[^,;.]{0,20}? issued by (?:a |an |the |any )?(?:freight )?${FWD}[^,;.]{0,20}? (?:is |are |will be |shall be )?${OK}\b`,
      "gi",
    ),
    negatable: false,
  },
  // “NOT ACCEPTED IF ISSUED BY FORWARDER”
  {
    re: new RegExp(String.raw`\bnot (?:be )?${OK}\b[^,;.]{0,25}?\b(?:issued by|from) (?:a |an |the |any )?(?:freight )?${FWD}`, "gi"),
    negatable: false,
  },
];

/** 命中位置之前、同一小句里是否有否定词 */
function negatedBefore(flat: string, index: number): boolean {
  const clauseStart = Math.max(flat.lastIndexOf(",", index), flat.lastIndexOf(";", index), flat.lastIndexOf(".", index), flat.lastIndexOf(":", index));
  return /\b(?:not|no)\b/i.test(flat.slice(clauseStart + 1, index));
}

export function detectCarrierBlClause(lc: LetterOfCredit): { field: "46A" | "47A"; snippet: string } | null {
  for (const field of ["46A", "47A"] as const) {
    const text = lc.raw[field];
    if (!text) continue;
    const flat = text.replace(/\s+/g, " ");
    for (const { re, negatable } of CLAUSES) {
      for (const m of flat.matchAll(re)) {
        if (negatable && negatedBefore(flat, m.index)) continue;
        return { field, snippet: flat.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim() };
      }
    }
  }
  return null;
}

export type IssuerKind = "carrier" | "forwarder" | "agent" | "unknown";

const FORWARDER = /forward(?:er|ers|ing)|nvocc|non[- ]vessel|logistic/i;
const CARRIER_CAPACITY = /\bas carrier\b|\bmaster\b|ship ?owner/i;
const NEGATION = /\bnot\b|\bnever\b|other than/i;

/**
 * 对一段文字做保守分类：只有明确写着“作为承运人 / 船长 / 船东”、且没有否定、代理、货代字样，才算承运人。
 * 单独一个 carrier 字样、owner 字样都不算
 */
export function classifyIssuer(text: string): IssuerKind {
  if (FORWARDER.test(text)) return "forwarder";
  if (/agent/i.test(text)) return "agent";
  if (NEGATION.test(text)) return "unknown";
  return CARRIER_CAPACITY.test(text) ? "carrier" : "unknown";
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
      evidence: { document: "policy", field: `country:${code}`, value: `${REQUIREMENT_LABELS.carrierBl.zh} / ${REQUIREMENT_LABELS.carrierBl.en}` },
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
    // 没有任何要求时无需数据，直接通过；有要求但没有运输单据数据时记为「未检查」。
    // 没有 52A 读不出开证国、而国别规则里有国家要求船东单时，要求本身无法判断，同样记为「未检查」，不能当作通过
    applicable: ({ lc, presentation }) => {
      if (sources(lc, rules).length > 0) return !!presentation.transport;
      return !(!lc.issuingCountry && rules.some((r) => r.enabled && r.requirements.includes("carrierBl")));
    },
    evaluate({ lc, presentation }) {
      const src = sources(lc, rules);
      if (src.length === 0) return [];
      const t = presentation.transport!;
      const name = (t.issuerName ?? "").trim();
      const capacity = (t.signingCapacity ?? "").trim();
      const issuer = [name, capacity].filter((x) => x !== "").join(" / ");
      // 货代字样在签发人名称或签发身份任一处出现都算；放行（通过）只认签发身份本身明确写着承运人
      const kind: IssuerKind = classifyIssuer([name, capacity].join(" ")) === "forwarder" ? "forwarder" : classifyIssuer(capacity);
      if (kind === "carrier") return [];
      const evidence: Evidence[] = src.map((x) => x.evidence);
      if (name) evidence.push({ document: "transport", field: "issuerName", value: name });
      if (capacity) evidence.push({ document: "transport", field: "signingCapacity", value: capacity });
      return [
        makeFinding({
          ruleId: CARRIER_BL_ID,
          clause,
          severity: "doubt",
          code: kind === "forwarder" ? "carrierBl.forwarder" : "carrierBl.confirm",
          params: { sourceZh: src.map((x) => x.zh).join("、"), sourceEn: src.map((x) => x.en).join(", "), issuer: issuer || "—" },
          evidence,
        }),
      ];
    },
  };
}
