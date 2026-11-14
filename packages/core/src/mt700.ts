import { parseSwiftDate } from "./dates";
import { AppError } from "./errors";
import type { LetterOfCredit } from "./model";

const FIELD_START = /^:(\d{2}[A-Z]?):/;

/**
 * 银行系统打印 / 导出（PDF、Word）的报文常在标签行上带字段标题：
 *   ":31C: DATE OF ISSUE"（值在下一行），或 ":31C:     DATE OF ISSUE 260625"（标题与值同一行）。
 * 标题（忽略大小写与标点、空白差异）丢弃，其余内容原样保留。
 * 标题本身可能是值的一部分的字段（申请人、受益人、费用）只在「整行恰好就是标题」时才丢弃。
 */
const SEP = "[^A-Za-z0-9]*";
const words = (s: string) => s.split(" ").join(SEP);
const FIELD_TITLES: Record<string, { body: string; exactOnly?: boolean }> = {
  "27": { body: words("SEQUENCE OF TOTAL") },
  "40A": { body: words("FORM OF DOCUMENTARY CREDIT") },
  "20": { body: words("DOCUMENTARY CREDIT NUMBER") },
  "31C": { body: words("DATE OF ISSUE") },
  "40E": { body: words("APPLICABLE RULES") },
  "31D": { body: words("DATE AND PLACE OF EXPIRY") },
  "50": { body: words("APPLICANT"), exactOnly: true },
  "59": { body: words("BENEFICIARY"), exactOnly: true },
  "32B": { body: words("CURRENCY CODE AMOUNT") },
  "39A": { body: words("PERCENTAGE CREDIT AMOUNT TOLERANCE") },
  "41D": { body: words("AVAILABLE WITH BY") },
  "42C": { body: words("DRAFTS AT") },
  "42A": { body: words("DRAWEE") },
  "43P": { body: words("PARTIAL SHIPMENTS") },
  "43T": { body: words("TRANSHIPMENT") },
  "44E": { body: words("PORT OF LOADING AIRPORT OF DEPARTURE") },
  "44F": { body: words("PORT OF DISCHARGE AIRPORT OF DESTINATION") },
  "44C": { body: words("LATEST DATE OF SHIPMENT") },
  "45A": { body: words("DESCRIPTION OF GOODS AND OR SERVICES") },
  "46A": { body: words("DOCUMENTS REQUIRED") },
  "47A": { body: words("ADDITIONAL CONDITIONS") },
  "71D": { body: words("CHARGES"), exactOnly: true },
  "48": { body: words("PERIOD FOR PRESENTATION IN DAYS") },
  "49": { body: words("CONFIRMATION INSTRUCTIONS") },
  "78": { body: `${words("INSTRUCTIONS TO THE")}${SEP}(?:${words("PAYING")}${SEP}${words("ACCEPTING")}${SEP})?${words("NEGOTIATING BANK")}` },
  "72Z": { body: words("SENDER TO RECEIVER INFORMATION") },
};
// 标题后可跟省略点与空白（"AVAILABLE WITH....BY...."、"DRAFTS AT..."）
const TITLE_RE = Object.fromEntries(Object.entries(FIELD_TITLES).map(([tag, t]) => [tag, new RegExp(`^\\s*${t.body}(?![A-Za-z0-9])[\\s.]*`, "i")]));

function stripFieldTitle(tag: string, rest: string): string {
  const re = TITLE_RE[tag];
  const m = re?.exec(rest);
  if (!m) return rest;
  const remainder = rest.slice(m[0].length);
  return FIELD_TITLES[tag]!.exactOnly && remainder.trim() !== "" ? rest : remainder;
}

/** 已知的 MT700 标签：只有这些标签才会在「行中间」被识别，避免把 "12:30:45" 之类的文字误当成标签 */
const KNOWN_TAGS = [...Object.keys(FIELD_TITLES), "23", "39B", "39C", "41A", "42D", "42M", "42P", "44A", "44B", "44D", "46B", "47B", "49G", "49H", "51A", "52A", "52D", "53A", "53D", "57A", "57D", "58A", "58D", "71B", "77B"];
// 前面有非空白字符、后面是空白或行尾的 ":NN:"，如 "XXXX:32B:     CURRENCY" / "…IN DUPLICATE :42A:     DRAWEE"
const MID_LINE_TAG = new RegExp(`(\\S)\\s*(:(?:${KNOWN_TAGS.join("|")}):)(?=\\s|$)`, "g");

// ───────────── SWIFT Alliance「Message Details Report」导出格式 ─────────────
// 标签写成 "F31C: Date of Issue"（可能有缩进），值带子字段标签（"Date: 270110 2027 Jan 10" / "Place: HONG KONG"）。
// 先转成标准的 ":31C:" 写法，后面的解析流程完全复用。

const ALLIANCE_TAG = /^\s*F(\d{2}[A-Z]?):\s*(.*)$/;
/** 这些字段在 Alliance 报告里的值带有 "Name and Address:" 之类的子字段标签，转换时去掉 */
const SUBLABEL_TAGS = new Set(["27", "40E", "41A", "41D", "42A", "50", "52A", "53A", "57A", "58A", "59"]);
const SUBLABEL = /^\s*(?:Name and Address|Applicable Rules|Identifier Code|Party Identifier|Code|Narrative|Name|Number|Total):\s*/i;
/** 报告尾部的固定文字：不属于任何字段 */
const ALLIANCE_END = /^\s*(?:Network Data|Network:|End of Message|Report Footer|Number of Entities|End of report)\b/i;

/** 标签行上的标题后面可能跟着 " - Name and Address - Code" / " - Party Identifier - Identifier Code" */
const TITLE_TAIL = /(?:\s+-\s+(?:Name and Address|Party Identifier|Identifier Code|Code))+\s*$/i;

function allianceBlock(tag: string, rawFirst: string, body: string[]): string[] {
  const first = rawFirst.replace(TITLE_TAIL, "");
  const all = [first, ...body];
  const joined = all.join("\n");
  if (tag === "31D") {
    // "Date: 270110 2027 Jan 10" + "Place: HONG KONG" → "270110HONG KONG"
    const d = /Date:\s*(\d{6})/i.exec(joined);
    const p = /Place:\s*([^\n]*)/i.exec(joined);
    if (d) return [`:31D:${d[1]}${p ? p[1]!.trim() : ""}`];
  }
  if (tag === "48") {
    // "Days: 21" + "Narrative: /WITHIN THE VALIDITY OF THE CREDIT" → "21/WITHIN THE VALIDITY OF THE CREDIT"
    const d = /Days:\s*(\d{1,3})/i.exec(joined);
    const n = /Narrative:\s*([^\n]*)/i.exec(joined);
    if (d) return [`:48:${d[1]}${n ? (n[1]!.trim().startsWith("/") ? n[1]!.trim() : `/${n[1]!.trim()}`) : " DAYS"}`];
  }
  if (tag === "32B") {
    // PDF 提取后标签与值的顺序可能错乱（"Currency:" "Amount:" "USD" "XXXXX," "US DOLLAR" "#XXXXXX,#"）：
    // 币种取第一个三字母大写词，金额取第一个由数字 / X / 逗号 / 小数点组成的词（不含 #…# 里的千分位写法）
    const tokens = joined.split(/\s+/).filter((t) => t !== "" && !t.startsWith("#"));
    const cur = tokens.find((t) => /^[A-Z]{3}$/.test(t));
    const amt = tokens.find((t) => /^[0-9Xx.,]*[0-9Xx][0-9Xx.,]*$/.test(t));
    if (cur && amt) return [`:32B:${cur}${amt}`];
  }
  const strip = (l: string) => (SUBLABEL_TAGS.has(tag) ? l.replace(SUBLABEL, "") : l);
  return [`:${tag}:${strip(first)}`, ...body.map(strip)];
}

export function allianceToSwift(message: string): string {
  const lines = message.replace(/\r\n?/g, "\n").split("\n");
  // 已经是标准写法，或不像 Alliance 报告（F 标签少于 3 个）：原样返回
  if (lines.some((l) => /^:\d{2}[A-Z]?:/.test(l))) return message;
  if (lines.filter((l) => ALLIANCE_TAG.test(l)).length < 3) return message;
  const out: string[] = [];
  let cur: { tag: string; first: string; body: string[] } | null = null;
  const flush = () => {
    if (cur) out.push(...allianceBlock(cur.tag, cur.first, cur.body));
    cur = null;
  };
  let ended = false;
  for (const line of lines) {
    const m = ALLIANCE_TAG.exec(line);
    if (m) {
      flush();
      ended = false;
      cur = { tag: m[1]!, first: m[2]!, body: [] };
    } else if (ALLIANCE_END.test(line)) {
      flush();
      ended = true;
    } else if (cur && !ended) {
      cur.body.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/** 按 SWIFT 标签拆分报文；同一标签重复出现时以换行拼接。 */
export function splitSwiftFields(rawMessage: string): Record<string, string> {
  const message = allianceToSwift(rawMessage);
  const fields: Record<string, string> = {};
  let tag: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (tag === null) return;
    const v = buf.join("\n").trim();
    fields[tag] = tag in fields ? `${fields[tag]}\n${v}` : v;
  };
  // Word / PDF 导出时，标签常跟在上一行文字后面（同一行里有多个标签）：先在标签前断行
  const normalized = message
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(MID_LINE_TAG, "$1\n$2"))
    .join("\n");
  for (const line of normalized.split("\n")) {
    const m = FIELD_START.exec(line);
    if (m) {
      flush();
      tag = m[1]!;
      buf = [stripFieldTitle(m[1]!, line.slice(m[0].length))];
    } else if (tag !== null && !PRINT_FOOTER.test(line) && !/^-\}?$|^\}/.test(line.trim())) {
      buf.push(line);
    }
  }
  flush();
  return fields;
}

/**
 * 日期字段（31C / 31D / 44C）的值：取第一个「行首 6 位数字」（YYMMDD）；其后同一行的文字是 rest（31D 的到期地点）。
 * 这样即使值前面夹着页眉页脚之类的杂行（如 "1 of 4 …"），也能读到日期；日期不合法时返回 undefined。
 */
function firstYymmdd(v: string): { date: string; rest: string } | undefined {
  const m = /(?:^|\n)[ \t]*(\d{6})(?!\d)([^\n]*)/.exec(v);
  const date = m ? parseSwiftDate(m[1]!) : undefined;
  return m && date ? { date, rest: m[2]!.trim() } : undefined;
}

/** 浏览器打印报文网页时带出的页脚，如 "1 of 4        01/02/2026, 6:13 pm"：不属于任何字段，丢弃 */
const PRINT_FOOTER = /^\s*(?:\d+\s+of\s+\d+\s+\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{1,2}:\d{2}(?:\s*[ap]m)?|Page\s+\d+\s+of\s*\d*)\s*$/i;

/** "100000,00" → 100000；SWIFT 以逗号为小数点 */
export function parseSwiftAmount(s: string): number | undefined {
  const m = /^(\d+)(?:,(\d*))?$/.exec(s.trim());
  if (!m) return undefined;
  return Number(`${m[1]}.${m[2] || "0"}`);
}

/** 50 / 59 字段：去掉以 "/" 开头的账号行后的第一行即名称 */
export function partyName(field?: string): string | undefined {
  const line = field
    ?.split("\n")
    .map((l) => l.trim())
    .find((l) => l !== "" && !l.startsWith("/"));
  return line || undefined;
}

const BIC = /^[A-Z]{4}([A-Z]{2})[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

/** 52A：可选的首行 /账号 或 /D/…，其后是 BIC。只在整行恰好是合法 BIC 时才取国家，其余一律不猜 */
export function parseBank(field?: string): { bic?: string; country?: string } {
  const line = field
    ?.split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("/"))
    .pop();
  // 大小写不敏感，但原行必须只由字母数字组成（含空格的自由文本一律不认）
  const bic = line && /^[A-Za-z0-9]+$/.test(line) ? line.toUpperCase() : undefined;
  const m = bic ? BIC.exec(bic) : null;
  return m ? { bic, country: m[1] } : {};
}

export class Mt700Error extends AppError {}

export function parseMt700(message: string): LetterOfCredit {
  const f = splitSwiftFields(message);

  const f32 = f["32B"];
  const cm = f32 ? /^([A-Z]{3})(.+)$/.exec(f32.trim()) : null;
  let amount = cm ? parseSwiftAmount(cm[2]!) : undefined;
  // 银行草稿里金额常写成 USDXXXXX,XX（尚未填写）：允许建案，金额记 0 并标记，由「未填写的占位符」规则提示
  const masked = amount === undefined && !!cm && /^[0-9.,]*[Xx][Xx0-9.,]*$/.test(cm[2]!.trim());
  if (masked) amount = 0;
  if (!cm || amount === undefined) {
    throw new Mt700Error("mt700.field32B", "字段 32B（币种与金额）缺失或格式无法识别");
  }
  if (!f["20"]) throw new Mt700Error("mt700.field20", "字段 20（信用证编号）缺失");

  const lc: LetterOfCredit = {
    reference: f["20"].trim(),
    currency: cm[1]!,
    amount,
    raw: f,
  };
  if (masked) lc.amountMasked = true;

  if (f["31C"]) lc.issueDate = firstYymmdd(f["31C"])?.date;
  if (f["31D"]) {
    const d = firstYymmdd(f["31D"]);
    if (d) {
      lc.expiryDate = d.date;
      lc.expiryPlace = d.rest || undefined;
    }
  }
  if (f["39A"]) {
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(f["39A"].trim());
    if (m) lc.tolerance = { plus: Number(m[1]), minus: Number(m[2]) };
  }
  if (f["44C"]) lc.latestShipmentDate = firstYymmdd(f["44C"])?.date;
  if (f["48"]) {
    // 标准写法 "nnn/补充说明"（如 021/AFTER THE DATE OF SHIPMENT、20/WITHIN THE VALIDITY OF THE CREDIT）；也兼容 "21 DAYS"
    // 标题折行时值落在后面某一行（如 "Period for\nPresentation in Days\n21/DAYS FROM…"），所以逐行匹配行首的数字
    const m = /(?:^|\n)\s*(\d{1,3})\s*(?:\/|DAYS?\b)/i.exec(f["48"]) ?? /(\d+)\s*DAYS?/i.exec(f["48"]);
    if (m) lc.presentationDays = Number(m[1]);
  }
  if (f["40A"]) lc.form = f["40A"].trim();
  const bank = parseBank(f["52A"]);
  lc.issuingBankBic = bank.bic;
  lc.issuingCountry = bank.country;
  lc.applicant = f["50"];
  lc.applicantName = partyName(f["50"]);
  lc.beneficiary = f["59"];
  lc.beneficiaryName = partyName(f["59"]);
  lc.portOfLoading = f["44E"]?.trim() || undefined;
  lc.portOfDischarge = f["44F"]?.trim() || undefined;
  lc.partialShipments = f["43P"]?.trim() || undefined;
  lc.transhipment = f["43T"]?.trim() || undefined;
  lc.goodsDescription = f["45A"];
  lc.documentsRequired = f["46A"];
  lc.additionalConditions = f["47A"];
  return lc;
}
