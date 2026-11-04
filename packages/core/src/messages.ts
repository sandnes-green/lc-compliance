import type { Finding } from "./model";
import { CUSTOM_CATALOG } from "./catalog-custom";
import { DOC_CATALOG } from "./catalog-docs";

export type Lang = "zh" | "en";

interface Text {
  message: string;
  suggestion?: string;
}

/** 不符点文案目录。模板占位符 {name} 取自 Finding.params。 */
const BASE_CATALOG: Record<string, Record<Lang, Text>> = {
  "presentation.expired": {
    zh: {
      message: "交单日 {presentationDate} 晚于信用证有效期 {expiryDate}",
      suggestion: "需在有效期内交单；如无法赶上，应尽早联系申请人办理展期修改。",
    },
    en: {
      message: "Presentation date {presentationDate} is after the credit expiry date {expiryDate}",
      suggestion: "Documents must be presented within the validity; if that is not possible, ask the applicant for an extension amendment as early as you can.",
    },
  },
  "presentation.stale": {
    zh: {
      message: "交单日 {presentationDate} 超过装运日 {shipmentDate} 后 {days} 天的期限（{deadline}），晚了 {late} 天",
      suggestion: "逾期交单（Stale documents）属不符点，银行有权拒付；建议联系申请人书面接受。",
    },
    en: {
      message: "Presentation date {presentationDate} is past the {days}-day limit after the shipment date {shipmentDate} (deadline {deadline}), {late} day(s) late",
      suggestion: "Late presentation (stale documents) is a discrepancy and the bank may refuse; ask the applicant for a written waiver.",
    },
  },
  "presentation.noShipmentDate": {
    zh: { message: "缺少运输单据的装运日期，无法核对交单期", suggestion: "请补充运输单据的装运/装船日期。" },
    en: { message: "The transport document has no shipment date, so the presentation period cannot be checked", suggestion: "Please enter the shipment / on-board date of the transport document." },
  },
  "invoice.currencyMismatch": {
    zh: { message: "发票币种 {invoiceCurrency} 与信用证币种 {lcCurrency} 不一致", suggestion: "发票应以 {lcCurrency} 开具。" },
    en: { message: "Invoice currency {invoiceCurrency} differs from the credit currency {lcCurrency}", suggestion: "The invoice must be issued in {lcCurrency}." },
  },
  "invoice.amountExceeded": {
    zh: {
      message: "发票金额 {amount} 超过信用证允许的最高金额 {max}（L/C 金额 {lcAmount}，上浮 {plus}%）",
      suggestion: "调减发票金额至 L/C 允许范围内，或要求申请人开立增额修改。",
    },
    en: {
      message: "Invoice amount {amount} exceeds the maximum allowed by the credit {max} (credit amount {lcAmount}, +{plus}% tolerance)",
      suggestion: "Reduce the invoice amount to within the credit limit, or ask the applicant for an amount increase amendment.",
    },
  },
  "shipment.late": {
    zh: {
      message: "装运日 {shipmentDate} 晚于最迟装运日 {latest}，迟 {late} 天",
      suggestion: "迟装属实质性不符点，无法通过改单据解决；应联系申请人申请展装修改。",
    },
    en: {
      message: "Shipment date {shipmentDate} is after the latest shipment date {latest}, {late} day(s) late",
      suggestion: "Late shipment is a substantive discrepancy that cannot be fixed by editing documents; ask the applicant for an amendment extending the shipment date.",
    },
  },
};

const CATALOG: Record<string, Record<Lang, Text>> = { ...BASE_CATALOG, ...DOC_CATALOG, ...CUSTOM_CATALOG };

const fill = (tpl: string, params: Finding["params"]) =>
  tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`));

export function renderText(code: string, params: Finding["params"], lang: Lang): Text | undefined {
  const t = CATALOG[code]?.[lang];
  return t && { message: fill(t.message, params), suggestion: t.suggestion && fill(t.suggestion, params) };
}

/** 规则内部使用：按中文文案目录生成完整 Finding */
export function makeFinding(f: Omit<Finding, "message" | "suggestion">): Finding {
  const t = renderText(f.code, f.params, "zh");
  if (!t) throw new Error(`未知的文案编码：${f.code}`);
  return { ...f, message: t.message, suggestion: t.suggestion };
}

/** 展示用：取指定语言文案；目录中没有时回退到存档的中文文案（兼容旧数据） */
export function localizeFinding(f: Finding, lang: Lang): Text {
  return renderText(f.code, f.params, lang) ?? { message: f.message, suggestion: f.suggestion };
}
