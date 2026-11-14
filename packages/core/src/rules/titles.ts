import type { Lang } from "../messages";

/** 规则名称（界面检查清单与导出报告共用）。新增规则时必须在这里补中英文名称，测试会检查。 */
export const RULE_TITLES: Record<string, Record<Lang, string>> = {
  "LCR-EXPIRY-VS-SHIPMENT": { zh: "有效期与最迟装运日", en: "Expiry vs latest shipment date" },
  "LCR-EXPIRY-PLACE": { zh: "到期地点", en: "Place of expiry" },
  "LCR-SOFT-CLAUSES": { zh: "疑似软条款", en: "Possible soft clauses" },
  "LCR-BURDENSOME-CLAUSES": { zh: "出口商难以满足或过于繁琐的条款", en: "Burdensome clauses for the exporter" },
  "LCR-SPARE-PARTS": { zh: "备品与免费货物", en: "Spare parts and free-of-charge goods" },
  "LCR-DATE-COHERENCE": { zh: "形式发票、保险暂保单与开证日", en: "Proforma invoice, cover note and issue dates" },
  "LCR-REF-TYPO": { zh: "编号笔误（字母 O 与数字 0）", en: "Reference typos (letter O vs digit 0)" },
  "LCR-TYPO-WORDS": { zh: "疑似拼写笔误", en: "Possible spelling slips" },
  "LCR-PLACEHOLDER": { zh: "未填写的占位符", en: "Unfilled placeholders" },
  "UCP600-14C-PRESENTATION": { zh: "交单期与有效期", en: "Presentation period & expiry" },
  "UCP600-18-INVOICE-AMOUNT": { zh: "发票币种与金额", en: "Invoice currency & amount" },
  "UCP600-20-LATEST-SHIPMENT": { zh: "最迟装运日", en: "Latest shipment date" },
  "UCP600-18A-INVOICE-PARTIES": { zh: "发票出具人与抬头", en: "Invoice issuer & addressee" },
  "UCP600-18C-GOODS": { zh: "发票货物描述", en: "Invoice goods description" },
  "UCP600-28-INSURANCE": { zh: "保险单币种、金额与日期", en: "Insurance currency, amount & date" },
  "UCP600-20A-PORTS": { zh: "装运港与卸货港", en: "Ports of loading & discharge" },
  "LCR-TOLERANCE": { zh: "金额与数量容差", en: "Amount and quantity tolerance" },
  "LCR-PARTIAL-TRANSHIP": { zh: "分批装运与转运", en: "Partial shipments and transhipment" },
  "LCR-PRESENTATION-CONFLICT": { zh: "交单期与到期日是否被重复规定", en: "Presentation period and expiry stated twice" },
  "LCR-FORM-RULES": { zh: "信用证类型与适用规则", en: "Form of credit and applicable rules" },
  "LCR-COUNTRY-RISK": { zh: "国别风险提示", en: "Country risk notice" },
  "UCP600-20-CARRIER-BL": { zh: "船东单（承运人签发提单）", en: "Carrier-issued bill of lading" },
};

/** 取规则名称；自定义检查项的标题由审查记录里的快照提供；未登记的规则回退为规则 ID */
export function ruleTitle(id: string, lang: Lang, custom?: Record<string, string>): string {
  return custom?.[id] ?? RULE_TITLES[id]?.[lang] ?? id;
}
