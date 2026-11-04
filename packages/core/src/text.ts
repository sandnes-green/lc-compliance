/**
 * 单据文字比较工具。目标是保守：宁可把「可能不一致」交给人工（疑点），
 * 也不把「确实不一致」判成一致。
 */

/** 公司名称里的通用后缀/冠词，比较时忽略（"SANDNES TRADING CO., LTD." ≈ "SANDNES TRADING CO LTD"） */
const NAME_NOISE = new Set(["CO", "COMPANY", "LTD", "LIMITED", "INC", "INCORPORATED", "CORP", "CORPORATION", "LLC", "GMBH", "THE", "AND", "&"]);

const upper = (s: string) => s.normalize("NFKC").toUpperCase();

/** 规范化为词序列：去标点、合并空白；数字里的千分位逗号先去掉 */
function words(s: string): string[] {
  return upper(s)
    .replace(/(?<=\d),(?=\d{3}\b)/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

export function normalizeName(s: string): string {
  return words(s)
    .filter((w) => !NAME_NOISE.has(w))
    .join(" ");
}

export type NameMatch = "same" | "close" | "different";

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length]![b.length]!;
}

/** 相同，或较长的词（≥5 字符）只差一个字符——视为可能的拼写差异 */
const wordsAlike = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && editDistance(a, b) <= 1);

/**
 * 名称比较：规范化后完全相同 → same；
 * 大部分词能对上（≥ 75%，允许词序不同、个别词拼写差一个字符）→ close（交人工）；其余 → different。
 */
export function compareNames(a: string, b: string): NameMatch {
  const wa = normalizeName(a).split(" ").filter(Boolean);
  const wb = normalizeName(b).split(" ").filter(Boolean);
  if (wa.length === 0 || wb.length === 0) return "different";
  if (wa.join(" ") === wb.join(" ")) return "same";
  const pool = [...wb];
  let matched = 0;
  for (const w of wa) {
    const i = pool.findIndex((x) => wordsAlike(w, x));
    if (i >= 0) {
      matched++;
      pool.splice(i, 1);
    }
  }
  return matched / Math.max(wa.length, wb.length) >= 0.75 ? "close" : "different";
}

/** 货描里没有比较意义的虚词 */
const STOP = new Set(["OF", "THE", "AND", "A", "AN", "IN", "TO", "FOR", "AS", "PER", "BY", "WITH", "ON", "AT", "OR"]);

/** 去掉简单的复数 S（SETS→SET），避免因单复数差异误报 */
const stem = (w: string) => (w.length > 3 && w.endsWith("S") && !w.endsWith("SS") ? w.slice(0, -1) : w);

export function goodsTokens(s: string): string[] {
  return [...new Set(words(s).filter((w) => !STOP.has(w)).map(stem))];
}

export interface GoodsComparison {
  /** 信用证货描中的词被单据覆盖的比例 0..1 */
  coverage: number;
  /** 信用证货描中单据里没有的词 */
  missing: string[];
}

/** 信用证货描的每个词是否都出现在单据货描里（单据可以有额外说明，但不能缺项） */
export function compareGoods(lcDescription: string, docDescription: string): GoodsComparison {
  const lc = goodsTokens(lcDescription);
  const doc = new Set(goodsTokens(docDescription));
  const missing = lc.filter((w) => !doc.has(w));
  return { coverage: lc.length === 0 ? 1 : (lc.length - missing.length) / lc.length, missing };
}

/** 港口比较：以逗号前的主名称为准（"SHANGHAI, CHINA" 与 "SHANGHAI" 视为一致） */
export function portMatches(lcPort: string, docPort: string): boolean {
  const main = (s: string) => words(s.split(",")[0] ?? s).join(" ");
  const a = main(lcPort);
  const b = main(docPort);
  return a !== "" && b !== "" && (a === b || a.includes(b) || b.includes(a));
}

/** 信用证里的港口是否是泛指（"ANY PORT IN CHINA"、"CHINESE MAIN PORT"），无法机械比对 */
export function isGenericPort(s: string): boolean {
  return /\b(ANY|MAIN|ONE OF|OR)\b/.test(upper(s));
}
