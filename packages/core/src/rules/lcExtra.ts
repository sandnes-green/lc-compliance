import { makeFinding } from "../messages";
import type { Evidence, Finding, IsoDate, LcRule, LetterOfCredit, Severity } from "../model";

/**
 * 审证补充规则：容差（Art.30）、分批与转运（Art.31 / Art.20(c)）、交单期与到期日冲突（Art.14(c)）、
 * 信用证类型与适用规则（40A / 40E，Art.1-3）。
 * 都是对信用证本身的检查，只用 MT700 字段与条款文字，不依赖交单数据。文字类判断是启发式的，
 * 凡是靠关键词推断的发现一律只报「疑点」，最终由人工判断。
 */

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const snip = (s: string, n = 140) => flat(s).slice(0, n);

/** 条款文字所在字段（审证时出口商最常需要细读的三处） */
const TEXT_FIELDS: [string, (lc: LetterOfCredit) => string | undefined][] = [
  ["45A", (lc) => lc.goodsDescription],
  ["46A", (lc) => lc.documentsRequired],
  ["47A", (lc) => lc.additionalConditions],
];

const lcEvidence = (field: string, value: string): Evidence => ({ document: "lc", field, value });

// ───────────── 容差 ─────────────

const ABOUT = /\b(?:ABOUT|APPROXIMATELY|APPROX\.?|CIRCA)\b/;
/** 以包装单位或个数计的数量：UCP600 第 30 条 b 款的 ±5% 数量容差不适用 */
const DISCRETE_UNITS = /\b\d[\d,.]*\s*(?:SETS?|PCS|PIECES?|UNITS?|PAIRS?|CARTONS?|BAGS?|PACKAGES?|PALLETS?|DRUMS?)\b/;

export const tolerance: LcRule = {
  stage: "lc",
  id: "LCR-TOLERANCE",
  clause: "UCP600 Art.30",
  title: "金额与数量容差",
  evaluate({ lc }) {
    const out: Finding[] = [];
    const t = lc.tolerance;
    const goods = lc.goodsDescription ? flat(lc.goodsDescription) : "";
    const upper = goods.toUpperCase();
    const emit = (severity: Severity, code: string, params: Finding["params"], evidence: Evidence[]) =>
      out.push(makeFinding({ ruleId: this.id, clause: this.clause, severity, code, params, evidence }));

    if (t) {
      const ev = [lcEvidence("39A", `${t.plus}/${t.minus}`)];
      if ((t.plus === 0) !== (t.minus === 0)) emit("info", "lc.tolerance.oneSided", { plus: t.plus, minus: t.minus }, ev);
      if (t.plus > 10 || t.minus > 10) emit("doubt", "lc.tolerance.large", { plus: t.plus, minus: t.minus }, ev);
    }

    const about = ABOUT.exec(upper);
    if (t && (t.plus > 0 || t.minus > 0) && about) {
      const s = snip(goods.slice(Math.max(0, about.index - 10), about.index + 50));
      emit("doubt", "lc.tolerance.aboutStacked", { snippet: s }, [lcEvidence("45A", s), lcEvidence("39A", `${t.plus}/${t.minus}`)]);
    }

    if (!t && !about) {
      const m = DISCRETE_UNITS.exec(upper);
      if (m) {
        const s = snip(goods.slice(m.index, m.index + m[0].length + 30));
        emit("info", "lc.tolerance.discreteUnits", { snippet: s }, [lcEvidence("45A", s)]);
      }
    }
    return out;
  },
};

// ───────────── 分批装运与转运 ─────────────

type Polarity = "yes" | "no" | "conditional";

/** 43P / 43T 字段值：ALLOWED / NOT ALLOWED / CONDITIONAL，其余写法不猜 */
function fieldPolarity(v: string | undefined): Polarity | undefined {
  if (!v) return undefined;
  const u = flat(v).toUpperCase();
  if (/\bCONDITIONAL\b/.test(u)) return "conditional";
  if (/\bNOT\s+(?:ALLOWED|PERMITTED|ACCEPTABLE)\b|\bPROHIBIT|\bFORBID/.test(u)) return "no";
  if (/\b(?:ALLOWED|PERMITTED|ACCEPTABLE)\b/.test(u)) return "yes";
  return undefined;
}

/** 条款文字里对某事项的明确表态，如 "PARTIAL SHIPMENTS ARE NOT ALLOWED"、"NO TRANSHIPMENT" */
function statedPolarities(text: string, keyword: string): { polarity: "yes" | "no"; start: number; end: number }[] {
  const re = new RegExp(
    String.raw`\bNO\s+${keyword}\b|\b${keyword}\b(?:\s+(?:IS|ARE|BE|TO\s+BE|SHALL\s+BE|MUST\s+BE))?\s*[:\-]?\s*(NOT\s+(?:ALLOWED|PERMITTED|ACCEPTABLE)|PROHIBITED|ALLOWED|PERMITTED|ACCEPTABLE)\b`,
    "g",
  );
  const out: { polarity: "yes" | "no"; start: number; end: number }[] = [];
  for (const m of text.matchAll(re)) {
    const verdict = m[1];
    const polarity = verdict === undefined || verdict.startsWith("NOT") || verdict === "PROHIBITED" ? "no" : "yes";
    out.push({ polarity, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const SHIP_KINDS = [
  { key: "partial", tag: "43P", keyword: String.raw`PARTIAL\s+SHIPMENTS?`, get: (lc: LetterOfCredit) => lc.partialShipments },
  { key: "tranship", tag: "43T", keyword: String.raw`TRANS-?\s?S?HIPMENTS?`, get: (lc: LetterOfCredit) => lc.transhipment },
] as const;

export const partialTranship: LcRule = {
  stage: "lc",
  id: "LCR-PARTIAL-TRANSHIP",
  clause: "UCP600 Art.31, Art.20(c)",
  title: "分批装运与转运",
  evaluate({ lc }) {
    const out: Finding[] = [];
    for (const kind of SHIP_KINDS) {
      const value = kind.get(lc);
      const pol = fieldPolarity(value);
      if (!value || !pol) continue;
      const fieldEv = lcEvidence(kind.tag, snip(value));
      const emit = (severity: Severity, suffix: string, params: Finding["params"], evidence: Evidence[]) =>
        out.push(makeFinding({ ruleId: this.id, clause: this.clause, severity, code: `lc.${kind.key}.${suffix}`, params, evidence }));

      if (pol === "no") emit("info", "notAllowed", {}, [fieldEv]);
      if (pol === "conditional") emit("doubt", "conditional", {}, [fieldEv]);
      if (pol === "conditional") continue;

      // 43P / 43T 与条款文字相互矛盾：每个事项只报第一处
      let reported = false;
      for (const [field, pick] of TEXT_FIELDS) {
        const text = pick(lc);
        if (!text || reported) continue;
        const orig = flat(text);
        const hit = statedPolarities(orig.toUpperCase(), kind.keyword).find((s) => s.polarity !== pol);
        if (!hit) continue;
        const s = snip(orig.slice(Math.max(0, hit.start - 20), hit.end + 40));
        emit("risk", "conflict", { field: flat(value), snippet: s }, [fieldEv, lcEvidence(field, s)]);
        reported = true;
      }
    }
    return out;
  },
};

// ───────────── 交单期 / 到期日在条款文字里被重复规定 ─────────────

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const TEXT_DATE = /\b(\d{1,2})\s?[-/.]?\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?[\s,\-/.]*(\d{4}|\d{2})\b|\b(\d{4})-(\d{2})-(\d{2})\b/;

/** 条款文字里的日期：只认「日 月名 年」与 ISO 两种写法，纯数字的 05/10/2024 有日月歧义，不猜 */
function parseTextDate(s: string): IsoDate | undefined {
  const m = TEXT_DATE.exec(s);
  if (!m) return undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  let y: number, mo: number, d: number;
  if (m[4]) {
    y = Number(m[4]);
    mo = Number(m[5]);
    d = Number(m[6]);
  } else {
    d = Number(m[1]);
    mo = MONTHS.indexOf(m[2]!) + 1;
    y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  }
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso ? undefined : iso;
}

const EXPIRY_CONTEXT = /\b(?:EXPIR(?:Y|ES?|ED|ING|ATION)|VALID(?:ITY)?|UNTIL)\b([^+;]{0,60})/g;
/** "N DAYS"，前面 100 字内出现「交单」字样、后面跟 AFTER / FROM / OF；排除汇票期限 "AT 60 DAYS AFTER …" */
const DAYS = /(?<!\bAT\s)\b(\d{1,3})\s*(?:CALENDAR\s+|WORKING\s+|BANKING\s+|CONSECUTIVE\s+)?DAYS?\b(?=\s+(?:AFTER|FROM|OF)\b)/g;

export const presentationConflict: LcRule = {
  stage: "lc",
  id: "LCR-PRESENTATION-CONFLICT",
  clause: "UCP600 Art.14(c), Art.6(d)",
  title: "交单期与到期日是否被重复规定",
  evaluate({ lc }) {
    const out: Finding[] = [];
    for (const [field, pick] of TEXT_FIELDS) {
      if (field === "45A") continue;
      const text = pick(lc);
      if (!text) continue;
      const orig = flat(text);
      const upper = orig.toUpperCase();

      // 48 字段规定的交单期与条款文字里的天数不一致
      if (lc.presentationDays !== undefined) {
        for (const m of upper.matchAll(DAYS)) {
          const before = upper.slice(Math.max(0, m.index - 100), m.index);
          if (!/PRESENT|NEGOTIAT/.test(before)) continue;
          const days = Number(m[1]);
          if (days === lc.presentationDays) continue;
          const s = snip(orig.slice(Math.max(0, m.index - 40), m.index + 70));
          out.push(
            makeFinding({
              ruleId: this.id,
              clause: this.clause,
              severity: "doubt",
              code: "lc.presentation.daysConflict",
              params: { fieldDays: lc.presentationDays, textDays: days, snippet: s },
              evidence: [lcEvidence("48", String(lc.presentationDays)), lcEvidence(field, s)],
            }),
          );
          break;
        }
      }

      // 31D 以外，条款文字又写了另一个到期日（双到期）
      if (lc.expiryDate) {
        for (const m of upper.matchAll(EXPIRY_CONTEXT)) {
          const date = parseTextDate(m[1]!);
          if (!date || date === lc.expiryDate) continue;
          const s = snip(orig.slice(m.index, m.index + m[0].length));
          out.push(
            makeFinding({
              ruleId: this.id,
              clause: this.clause,
              severity: "doubt",
              code: "lc.expiry.textConflict",
              params: { expiry: lc.expiryDate, textDate: date, snippet: s },
              evidence: [lcEvidence("31D", lc.expiryDate), lcEvidence(field, s)],
            }),
          );
          break;
        }
      }
    }
    return out;
  },
};

// ───────────── 信用证类型与适用规则 ─────────────

const OLD_UCP = /\bUCP\s*-?\s*500\b|\bUCP\s+NO\.?\s*500\b|\bICC\s+PUBLICATION\s+(?:NO\.?\s*)?500\b/;

export const formAndRules: LcRule = {
  stage: "lc",
  id: "LCR-FORM-RULES",
  clause: "UCP600 Art.1-3",
  title: "信用证类型与适用规则",
  evaluate({ lc }) {
    const out: Finding[] = [];
    const emit = (severity: Severity, code: string, params: Finding["params"], evidence: Evidence[]) =>
      out.push(makeFinding({ ruleId: this.id, clause: this.clause, severity, code, params, evidence }));

    // 40A
    if (!lc.form) {
      emit("doubt", "lc.form.missing", {}, []);
    } else {
      const form = flat(lc.form).toUpperCase();
      const ev = [lcEvidence("40A", form)];
      if (/\bREVOC(?:ABLE)?\b/.test(form)) emit("risk", "lc.form.revocable", { form }, ev);
      if (/TRANSFER/.test(form)) emit("info", "lc.form.transferable", { form }, ev);
      if (/STANDBY/.test(form)) emit("info", "lc.form.standby", { form }, ev);
    }

    // 40E
    const rules = lc.raw["40E"] ? flat(lc.raw["40E"]).toUpperCase() : "";
    if (!rules) {
      emit("doubt", "lc.rules.missing", {}, []);
    } else {
      const ev = [lcEvidence("40E", rules)];
      if (/^(?:UCP|UCPURR|EUCP|EUCPURR)\b/.test(rules)) {
        // UCP / eUCP：正常
      } else if (/^(?:ISP|URDG)/.test(rules)) {
        emit("doubt", "lc.rules.nonUcp", { rules }, ev);
      } else if (/^OTHR\b/.test(rules)) {
        emit("risk", "lc.rules.other", { rules }, ev);
      } else {
        emit("doubt", "lc.rules.unknown", { rules }, ev);
      }
    }

    // 条款文字里引用了已被取代的 UCP 500
    for (const [field, pick] of TEXT_FIELDS) {
      const text = pick(lc);
      if (!text) continue;
      const orig = flat(text);
      const m = OLD_UCP.exec(orig.toUpperCase());
      if (!m) continue;
      const s = snip(orig.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30));
      emit("risk", "lc.rules.oldUcp", { snippet: s }, [lcEvidence(field, s)]);
      break;
    }
    return out;
  },
};

export const lcExtraRules: LcRule[] = [tolerance, partialTranship, presentationConflict, formAndRules];
