import { parseSwiftDate } from "./dates";
import { AppError } from "./errors";
import type { LetterOfCredit } from "./model";

const FIELD_START = /^:(\d{2}[A-Z]?):/;

/** 按 SWIFT 标签拆分报文；同一标签重复出现时以换行拼接。 */
export function splitSwiftFields(message: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let tag: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (tag === null) return;
    const v = buf.join("\n").trim();
    fields[tag] = tag in fields ? `${fields[tag]}\n${v}` : v;
  };
  for (const line of message.replace(/\r\n?/g, "\n").split("\n")) {
    const m = FIELD_START.exec(line);
    if (m) {
      flush();
      tag = m[1]!;
      buf = [line.slice(m[0].length)];
    } else if (tag !== null && !/^-\}?$|^\}/.test(line.trim())) {
      buf.push(line);
    }
  }
  flush();
  return fields;
}

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
  const amount = cm ? parseSwiftAmount(cm[2]!) : undefined;
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

  if (f["31C"]) lc.issueDate = parseSwiftDate(f["31C"].trim());
  if (f["31D"]) {
    const m = /^(\d{6})(.*)$/s.exec(f["31D"].trim());
    if (m) {
      lc.expiryDate = parseSwiftDate(m[1]!);
      lc.expiryPlace = m[2]!.trim() || undefined;
    }
  }
  if (f["39A"]) {
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec(f["39A"].trim());
    if (m) lc.tolerance = { plus: Number(m[1]), minus: Number(m[2]) };
  }
  if (f["44C"]) lc.latestShipmentDate = parseSwiftDate(f["44C"].trim());
  if (f["48"]) {
    const m = /(\d+)\s*DAYS?/i.exec(f["48"]);
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
