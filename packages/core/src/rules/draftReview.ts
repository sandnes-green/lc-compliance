import { diffDays } from "../dates";
import { makeFinding } from "../messages";
import type { Finding, LcRule, LetterOfCredit, Severity } from "../model";

/**
 * 审稿：对银行发来的信用证草稿 / 正本做出口商视角的检查。规律来自样本中
 * 「初稿 → 修改建议 → 正本 / 修改件」的对照：
 *  - 出口商要求删除的多是自己无法或不便满足的单据条款（承运人证明、快递收据随单、船代信息、发票装箱单版式）；
 *  - 银行在草稿里常留下占位符、过期的保险暂保单日期，以及 O/0 之类的笔误，后来都以修改件更正；
 *  - 货物描述里写死备品数量，随货另发免费备品时会与发票不符。
 * 这些都是启发式提示，最终由人工判断。
 */

const FIELDS: [string, (lc: LetterOfCredit) => string | undefined][] = [
  ["45A", (lc) => lc.goodsDescription],
  ["46A", (lc) => lc.documentsRequired],
  ["47A", (lc) => lc.additionalConditions],
];

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const snippet = (s: string) => flat(s).slice(0, 140);

/** 条款边界：以 "+" 开头的条款，或形如 " 04. " 的编号条款（"21.5-INCH"、"NO.1" 不会误判） */
const CLAUSE_BOUNDARY = /\+|(?<=\s)\d{1,2}\.(?=\s)/g;
const CLAUSE_MAX = 240;

/**
 * 取命中处所在的整条条款作为证据（从条款开头到下一条款之前），让人能在原文里一眼找到。
 * endAtMatch 为真时只取到命中处结尾（用于一条里夹着多个事项的情况）。
 */
function clauseBounds(text: string, index: number, length: number, endAtMatch = false): { start: number; end: number } {
  let start = 0;
  let end = endAtMatch ? index + length : text.length;
  for (const b of text.matchAll(CLAUSE_BOUNDARY)) {
    if (b.index < index) start = b[0] === "+" ? b.index + 1 : b.index;
    else if (b.index >= index + length) {
      if (!endAtMatch) end = b.index;
      break;
    }
  }
  return { start, end };
}

function clauseAround(text: string, index: number, length: number, endAtMatch = false): string {
  const { start, end } = clauseBounds(text, index, length, endAtMatch);
  const s = text.slice(start, end).replace(/[\s.]+$/, "").trim();
  if (s.length <= CLAUSE_MAX) return s;
  // 条款太长时以命中处为中心截取（不然关键的那句话可能被截掉），并在词边界处断开
  let from = Math.max(start, index - CLAUSE_MAX / 3);
  let to = Math.min(end, index + length + CLAUSE_MAX / 3);
  if (from > start) from = text.indexOf(" ", from) + 1 || from;
  if (to < end) to = text.lastIndexOf(" ", to) > index + length ? text.lastIndexOf(" ", to) : to;
  const cut = text.slice(from, to).replace(/[\s.]+$/, "").trim();
  return `${from > start ? "…" : ""}${cut}${to < end ? "…" : ""}`;
}

// ───────────── 出口商难以满足 / 过于繁琐的条款 ─────────────

interface BurdenPattern {
  code: string;
  re: RegExp;
}

const BURDEN_PATTERNS: BurdenPattern[] = [
  // 须由承运人 / 船东 / 船长出具船舶适航等证明：承运人通常不出具，出口商无法自行取得
  {
    code: "lc.burden.carrierCert",
    re: /\bCERTIFICATES?\s+(?:TO\s+THIS\s+EFFECT\s+)?(?:ISSUED\s+|GIVEN\s+)?(?:BY|FROM)\s+(?:THE\s+)?(?:CARRIER|SHIP\s?OWNER|SHIPPING\s+COMPANY|MASTER|VESSEL)\b|\b(?:SEAWORTHY|SEAWORTHINESS|CLASSIFICATION)\s+CERTIFICATE\b/,
  },
  // 快递收据 / 电邮副本 / 发送证明须随正本单据一并提交
  {
    code: "lc.burden.dispatchProof",
    re: /\b(?:COURIER\s+RECEIPT|E-?MAIL\s+COPY|DISPATCH\s+PROOF|PROOF\s+OF\s+(?:COURIER|DISPATCH|E-?MAIL))\b[^+]{0,80}?\bACCOMPANY\b|\bTOGETHER\s+WITH\s+(?:COURIER\s+OR\s+E-?MAIL\s+|COURIER\s+|E-?MAIL\s+)?DISPATCH\s+PROOF\b/,
  },
  // 提单上须显示孟加拉本地船代 / 承运人的名称、地址、电话：使用 master B/L 时提单上没有这些信息
  {
    code: "lc.burden.localAgentBl",
    re: /\bNAME,?\s+ADDRESS[^+]{0,120}?\b(?:SHIPPING\s+AGENT|AGENT)\b[^+]{0,120}?\bMENTIONED\s+(?:IN|ON)\s+(?:THE\s+)?(?:BILL\s+OF\s+LADING|B\/L)\b/,
  },
  // 对发票 / 装箱单版式的细节要求
  {
    code: "lc.burden.docFormat",
    re: /\bTABULAR\s+FORMAT\b|\bCOLUMN\s+HEADINGS?\b|\bITEM[\s-]?WISE\b/,
  },
];

/** 同一字段里同一种条款最多列出几条 */
const BURDEN_MAX = 5;

export const burdensomeClauses: LcRule = {
  stage: "lc",
  id: "LCR-BURDENSOME-CLAUSES",
  clause: "Risk review: burdensome clauses",
  title: "出口商难以满足或过于繁琐的条款",
  evaluate({ lc }) {
    const out: Finding[] = [];
    for (const [field, pick] of FIELDS) {
      if (field === "45A") continue;
      const text = pick(lc);
      if (!text) continue;
      const f = flat(text).toUpperCase();
      const orig = flat(text);
      // 每种条款逐条列出（如 47A 的第 06、07 条都是版式要求），但同一条条款里多处命中只报一次
      for (const { code, re } of BURDEN_PATTERNS) {
        const seenClauses = new Set<number>();
        for (const m of f.matchAll(new RegExp(re.source, "g"))) {
          const { start } = clauseBounds(orig, m.index, m[0].length);
          if (seenClauses.has(start) || seenClauses.size >= BURDEN_MAX) continue;
          seenClauses.add(start);
          const value = clauseAround(orig, m.index, m[0].length);
          out.push(
            makeFinding({
              ruleId: this.id,
              clause: this.clause,
              severity: code === "lc.burden.dispatchProof" ? "doubt" : "risk",
              code,
              params: { snippet: value },
              evidence: [{ document: "lc", field, value }],
            }),
          );
        }
      }
    }
    return out;
  },
};

// ───────────── 货物描述里的备品 ─────────────

const FOC = /FREE\s+OF\s+CHARGE|\bFOC\b|NO\s+COMMERCIAL\s+VALUE|FREE\s+SAMPLES?/;

export const spareParts: LcRule = {
  stage: "lc",
  id: "LCR-SPARE-PARTS",
  clause: "UCP600 Art.18(c), Art.30",
  title: "备品与免费货物",
  evaluate({ lc }) {
    const goods = lc.goodsDescription;
    if (!goods) return [];
    const f = flat(goods).toUpperCase();
    const m = /\bSPARE\s+PARTS?\b(?:\s+QUANTITY\s*:?\s*\d+\s*[A-Z]*)?/.exec(f);
    if (!m) return [];
    const all = FIELDS.map(([, pick]) => pick(lc) ?? "").join(" ").toUpperCase();
    if (FOC.test(all)) return [];
    const value = clauseAround(flat(goods), m.index, m[0].length, true);
    return [
      makeFinding({
        ruleId: this.id,
        clause: this.clause,
        severity: "doubt",
        code: "lc.spareParts",
        params: { snippet: value },
        evidence: [{ document: "lc", field: "45A", value }],
      }),
    ];
  },
};

// ───────────── 日期自洽：形式发票、保险暂保单、开证日 ─────────────

const MONTHS: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
// 数字日期：dd.mm.yyyy / dd/mm/yyyy / dd-mm-yyyy；前面不能紧跟数字，避免把 "MC-1057/08/2026" 里的 "57/08/2026" 当成日期
const NUM_DATE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/g;
const MON_DATE = /(?<!\d)(\d{1,2})[\s.-]*([A-Z]{3})[A-Z]*[\s.,-]*(\d{4})(?!\d)/gi;

function isoDate(y: number, m: number, d: number): string | undefined {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return undefined;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

/** 文中第一个日期：iso 为标准化结果，end 为该日期在 s 中的结束位置（用来截取证据） */
function firstDate(s: string): { iso: string; end: number } | undefined {
  const found: { i: number; end: number; iso: string }[] = [];
  for (const m of s.matchAll(NUM_DATE)) {
    const iso = isoDate(+m[3]!, +m[2]!, +m[1]!);
    if (iso) found.push({ i: m.index, end: m.index + m[0].length, iso });
  }
  for (const m of s.matchAll(MON_DATE)) {
    const mo = MONTHS[m[2]!.toUpperCase()];
    const iso = mo ? isoDate(+m[3]!, mo, +m[1]!) : undefined;
    if (iso) found.push({ i: m.index, end: m.index + m[0].length, iso });
  }
  const first = found.sort((a, b) => a.i - b.i)[0];
  return first && { iso: first.iso, end: first.end };
}

interface DatedRef {
  field: string;
  iso: string;
  value: string;
}

/** 在各字段里找 label 之后一小段内的第一个日期；label 出现多次时取第一个带日期的 */
function findDatedRef(lc: LetterOfCredit, label: RegExp, window: number): DatedRef | undefined {
  for (const [field, pick] of FIELDS) {
    const text = pick(lc);
    if (!text) continue;
    const f = flat(text);
    for (const m of f.matchAll(new RegExp(label.source, "gi"))) {
      const tail = f.slice(m.index + m[0].length, m.index + m[0].length + window);
      const d = firstDate(tail);
      // 证据取「标签……日期」这一段，不带后面无关的文字
      if (d) return { field, iso: d.iso, value: f.slice(m.index, m.index + m[0].length + d.end) };
    }
  }
  return undefined;
}

/** 形式发票日期比开证日早超过这么多天，提示一下价格是否仍有效 */
const PROFORMA_STALE_DAYS = 120;
const PROFORMA = /PROFORMA\s+INVOICE\s+(?:NUMBER\s+AND\s+DATE|NUMBER|NO\.?)/;
const COVER_NOTE = /COVER\s+NOTE\s+(?:NUMBER\s+AND\s+DATE|NUMBER|NO\.?)/;

export const dateCoherence: LcRule = {
  stage: "lc",
  id: "LCR-DATE-COHERENCE",
  clause: "Draft review: dates",
  title: "形式发票、保险暂保单与开证日",
  evaluate({ lc }) {
    const out: Finding[] = [];
    const pi = findDatedRef(lc, PROFORMA, 70);
    const cover = findDatedRef(lc, COVER_NOTE, 70);
    const issue = lc.issueDate;
    const push = (code: string, params: Record<string, string | number>, refs: DatedRef[], severity: Severity = "doubt") =>
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity,
          code,
          params,
          evidence: [
            ...refs.map((r) => ({ document: "lc" as const, field: r.field, value: r.value })),
            ...(issue ? [{ document: "lc" as const, field: "31C", value: issue }] : []),
          ],
        }),
      );
    // 暂保单早于形式发票：多半是沿用了上一单的旧暂保单（样本里正本都改成了形式发票之后、开证日之前）
    if (pi && cover && cover.iso < pi.iso) push("lc.dates.coverBeforeProforma", { cover: cover.iso, proforma: pi.iso }, [cover, pi]);
    if (issue && pi && pi.iso > issue) push("lc.dates.proformaAfterIssue", { proforma: pi.iso, issue }, [pi]);
    if (issue && cover && cover.iso > issue) push("lc.dates.coverAfterIssue", { cover: cover.iso, issue }, [cover]);
    // 形式发票比开证日早很多：价格可能已过期（样本里的形式发票都在开证前几天到两周内）
    const age = issue && pi ? diffDays(issue, pi.iso) : 0;
    if (issue && pi && age > PROFORMA_STALE_DAYS) push("lc.dates.proformaStale", { proforma: pi.iso, issue, days: age }, [pi], "info");
    return out;
  },
};

// ───────────── 笔误：编号里的字母 O 与数字 0 ─────────────

export const letterOTypo: LcRule = {
  stage: "lc",
  id: "LCR-REF-TYPO",
  clause: "Draft review: typos",
  title: "编号笔误（字母 O 与数字 0）",
  evaluate({ lc }) {
    const out: Finding[] = [];
    for (const [field, pick] of FIELDS) {
      const text = pick(lc);
      if (!text) continue;
      const seen = new Set<string>();
      for (const m of text.toUpperCase().matchAll(/[A-Z0-9][A-Z0-9/-]{4,}/g)) {
        const tok = m[0];
        // 至少 3 个数字，且有字母 O 紧挨着数字：CCTO6O331、X24IFR12O。纯单词（如 INCOTERMS）不会命中
        if ((tok.match(/\d/g)?.length ?? 0) < 3 || !/(?<=\d)O|O(?=\d)/.test(tok) || seen.has(tok)) continue;
        seen.add(tok);
        out.push(
          makeFinding({
            ruleId: this.id,
            clause: this.clause,
            severity: "doubt",
            code: "lc.typo.letterO",
            params: { token: tok, suggested: tok.replace(/(?<=\d)O|O(?=\d)/g, "0") },
            evidence: [{ document: "lc", field, value: tok }],
          }),
        );
      }
    }
    return out;
  },
};

// ───────────── 疑似拼写笔误（低优先级提示） ─────────────

/** 信用证里常见的词（≥6 个字母）。只用来发现「与其中某个词只差一个字母」的疑似笔误，不是拼写词典 */
const VOCAB_BASE = [
  "COMPUTER", "MONITOR", "INVOICE", "PROFORMA", "BENEFICIARY", "APPLICANT", "DOCUMENT", "DOCUMENTARY", "SHIPMENT", "SHIPPING", "SHIPPED", "SHIPPER",
  "CERTIFICATE", "CERTIFIED", "CERTIFYING", "CERTIFY", "ORIGINAL", "ORIGIN", "PACKING", "PACKAGE", "QUANTITY", "DESCRIPTION", "SPECIFICATION",
  "PRESENT", "PRESENTATION", "DISCREPANCY", "ACCEPTABLE", "ACCOMPANY", "ADDITIONAL", "AUTHORITY", "BANGLADESH", "CHAMBER", "COMMERCE", "COMMERCIAL",
  "CONDITION", "CONSIGNMENT", "CONTAINER", "COUNTRY", "CREDIT", "EVIDENCING", "EXPORTING", "FREIGHT", "INSURANCE", "INSURED", "ISSUED", "ISSUING",
  "ISSUANCE", "LADING", "MENTION", "NEGOTIABLE", "NEGOTIATING", "NEGOTIATION", "NEGOTIATED", "NOTIFY", "PAYMENT", "PERCENT", "PREPAID", "REFERENCE",
  "REQUIRE", "REQUIRED", "SEAWORTHY", "SEAPORT", "SEPARATELY", "STANDARD", "TRANSPORT", "TRANSHIPMENT", "TRANSSHIPMENT", "UNITED", "REGULATION",
  "ORGANISATION", "ORGANIZATION", "GOVERNMENT", "APPROVED", "AMOUNT", "CHARGE", "COURIER", "DISPATCH", "ADDRESS", "CARRIER", "AGENCY", "ORIGINATE",
];
/** 词形变化：复数、过去式、-ing、-er、-ly；-e 结尾与 -y 结尾的词另有变形 */
function wordForms(w: string): string[] {
  const f = [w, `${w}S`, `${w}ES`, `${w}ED`, `${w}D`, `${w}ING`, `${w}ER`, `${w}ERS`, `${w}LY`];
  if (w.endsWith("E")) f.push(`${w.slice(0, -1)}ING`);
  if (w.endsWith("Y")) f.push(`${w.slice(0, -1)}IES`, `${w.slice(0, -1)}IED`);
  return f;
}
const VOCAB_FORMS = new Set(VOCAB_BASE.flatMap(wordForms));

/** a 与 b 恰好差一个字母：多一个、少一个、写错一个，或相邻两个字母写反 */
function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (i === a.length) return false; // 完全相同
    return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** 疑似笔误：不是已知词、与某个已知词只差一个字母、末位字母相同、且不是「已知词 + 词尾」（排除 INVOICES 之类的正常变形） */
function nearVocab(word: string): string | undefined {
  for (const v of VOCAB_FORMS) {
    if (word[word.length - 1] === v[v.length - 1] && !word.startsWith(v) && !v.startsWith(word) && oneEdit(word, v)) return v;
  }
  return undefined;
}

const HYPHEN_DECIMAL = /(?<![\d.-])(\d{1,3})-(\d{1,2})-(INCH|MM|CM|KG)\b/g;
const TYPO_MAX = 5;

export const typoWords: LcRule = {
  stage: "lc",
  id: "LCR-TYPO-WORDS",
  clause: "Draft review: typos",
  title: "疑似拼写笔误",
  evaluate({ lc }) {
    const out: Finding[] = [];
    for (const [field, pick] of FIELDS) {
      const text = pick(lc);
      if (!text) continue;
      const upper = flat(text).toUpperCase();
      for (const m of upper.matchAll(HYPHEN_DECIMAL)) {
        const token = m[0];
        out.push(
          makeFinding({
            ruleId: this.id,
            clause: this.clause,
            severity: "info",
            code: "lc.typo.hyphenDecimal",
            params: { token, suggested: `${m[1]}.${m[2]}-${m[3]}` },
            evidence: [{ document: "lc", field, value: token }],
          }),
        );
      }
      const seen = new Set<string>();
      for (const m of upper.matchAll(/[A-Z]{6,}/g)) {
        const word = m[0];
        if (seen.has(word) || seen.size >= TYPO_MAX || VOCAB_FORMS.has(word)) continue;
        const near = nearVocab(word);
        if (!near) continue;
        seen.add(word);
        out.push(
          makeFinding({
            ruleId: this.id,
            clause: this.clause,
            severity: "info",
            code: "lc.typo.word",
            params: { token: word, suggested: near },
            evidence: [{ document: "lc", field, value: clauseAround(flat(text), m.index, word.length) }],
          }),
        );
      }
    }
    return out;
  },
};

// ───────────── 草稿里没填的占位符 ─────────────

/** 每个字段最多列出的占位符个数，避免整段被打码的文本刷屏 */
const PLACEHOLDER_MAX = 6;

export const placeholders: LcRule = {
  stage: "lc",
  id: "LCR-PLACEHOLDER",
  clause: "Draft review: placeholders",
  title: "未填写的占位符",
  evaluate({ lc }) {
    const out: Finding[] = [];
    if (lc.amountMasked) {
      const value = lc.raw["32B"] ? snippet(lc.raw["32B"]) : "";
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity: "doubt",
          code: "lc.placeholder",
          params: { snippet: value },
          evidence: [{ document: "lc", field: "32B", value }],
        }),
      );
    }
    for (const [field, pick] of FIELDS) {
      const text = pick(lc);
      if (!text) continue;
      const f = flat(text);
      // XX / XXXX：前后不能是字母，避免误伤 BIC（SCBLBDDXXXX）与单词
      // 单价 XX.XX、XXX.XX 这样中间带小数点的写法算一处
      const hits = [...f.matchAll(/(?<![A-Za-z])[Xx]{2,}(?:\.[Xx]{2,})*(?![A-Za-z])/g)].slice(0, PLACEHOLDER_MAX);
      if (hits.length === 0) continue;
      // 同一字段里的每一处都列出（带前面一小段上下文，便于定位），相邻的上下文不重复取
      const pieces: string[] = [];
      let prevEnd = 0;
      for (const m of hits) {
        const from = Math.max(prevEnd, m.index - 30);
        let piece = f.slice(from, m.index + m[0].length);
        if (from > 0 && from > prevEnd) piece = piece.replace(/^\S*\s/, ""); // 去掉被截断的半个词
        pieces.push(piece.trim());
        prevEnd = m.index + m[0].length;
      }
      const value = pieces.join(" … ");
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity: "doubt",
          code: "lc.placeholder",
          params: { snippet: value },
          evidence: [{ document: "lc", field, value }],
        }),
      );
    }
    return out;
  },
};

export const draftReviewRules: LcRule[] = [burdensomeClauses, spareParts, dateCoherence, letterOTypo, typoWords, placeholders];
