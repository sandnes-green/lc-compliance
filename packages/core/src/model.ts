/** 日期统一使用 ISO 字符串 YYYY-MM-DD。金额使用 number，比较时按分取整。 */
export type IsoDate = string;

export interface LetterOfCredit {
  reference: string;
  /** 40A：信用证类型，如 IRREVOCABLE */
  form?: string;
  /** 52A：开证行 BIC 及其第 5、6 位国家代码；52D 等无 BIC 的写法读不出，保持为空 */
  issuingBankBic?: string;
  issuingCountry?: string;
  issueDate?: IsoDate;
  expiryDate?: IsoDate;
  expiryPlace?: string;
  currency: string;
  amount: number;
  /** 39A：金额上下浮动百分比 */
  tolerance?: { plus: number; minus: number };
  latestShipmentDate?: IsoDate;
  /** 48：交单期（天），缺省按 UCP600 第 14 条 c 款为 21 */
  presentationDays?: number;
  /** 50 / 59 的完整文本与其中的名称（首行，已去掉 /账号 行） */
  applicant?: string;
  applicantName?: string;
  beneficiary?: string;
  beneficiaryName?: string;
  /** 44E / 44F：装运港 / 卸货港 */
  portOfLoading?: string;
  portOfDischarge?: string;
  /** 43P / 43T：分批装运 / 转运 */
  partialShipments?: string;
  transhipment?: string;
  goodsDescription?: string;
  documentsRequired?: string;
  additionalConditions?: string;
  /** 原始字段，便于追溯 */
  raw: Record<string, string>;
}

export interface InvoiceData {
  currency?: string;
  amount?: number;
  date?: IsoDate;
  /** 发票上的卖方 / 买方名称、货物描述 */
  sellerName?: string;
  buyerName?: string;
  goodsDescription?: string;
}

export interface TransportDocData {
  /** 装船批注日期 / 发运日期 */
  shipmentDate?: IsoDate;
  portOfLoading?: string;
  portOfDischarge?: string;
}

export interface InsuranceData {
  currency?: string;
  /** 投保金额 */
  amount?: number;
  /** 保险单签发 / 生效日期 */
  date?: IsoDate;
}

export interface Presentation {
  /** 拟交单日期 */
  presentationDate: IsoDate;
  invoice?: InvoiceData;
  transport?: TransportDocData;
  insurance?: InsuranceData;
}

/** 已导入单据的文字（OCR / 文字层 / 人工修正后的），供自定义检查项按原文核对 */
export interface PresentedText {
  docType: "invoice" | "transport" | "insurance";
  fileName: string;
  text: string;
}

/** 审单规则的输入：信用证 + 拟交单据（含已导入单据的原文） */
export interface CaseContext {
  lc: LetterOfCredit;
  presentation: Presentation;
  documents?: PresentedText[];
}

/**
 * discrepancy 不符点：单据与信用证/彼此之间确定不符，银行可据此拒付
 * risk        风险：信用证本身的条款存在隐患（审证）
 * doubt       疑点：无法确定，需人工核对
 * info        提示
 */
export type Severity = "discrepancy" | "risk" | "doubt" | "info";

export interface Evidence {
  document: "lc" | "invoice" | "transport" | "insurance" | "manual";
  field: string;
  value: string;
}

export interface Finding {
  ruleId: string;
  /** 条款依据，如 "UCP600 Art.14(c)" */
  clause: string;
  severity: Severity;
  /** 文案编码与参数；展示时用 localizeFinding(f, lang) 取对应语言文案 */
  code: string;
  params: Record<string, string | number>;
  /** 中文默认文案（由 code+params 生成），用于日志与不支持本地化的场景 */
  message: string;
  evidence: Evidence[];
  /** 给出口企业的修改建议 */
  suggestion?: string;
  /** 属于审证（信用证本身）还是审单（单据）；由引擎按规则类型标注 */
  stage?: "lc" | "docs";
}

interface RuleBase {
  id: string;
  clause: string;
  title: string;
}

/** 审证规则：只依赖信用证本身，收到信用证后即可运行 */
export interface LcRule extends RuleBase {
  stage: "lc";
  evaluate(ctx: { lc: LetterOfCredit }): Finding[];
}

/** 审单规则：需要拟交单据数据 */
export interface PresentationRule extends RuleBase {
  stage: "presentation";
  /** 所需数据不足时返回 false：该规则会被记为「未检查」，而不是悄悄「通过」 */
  applicable?(ctx: CaseContext): boolean;
  evaluate(ctx: CaseContext): Finding[];
}

/** 只依赖已导入单据原文的规则（如自定义的关键词检查），不要求录入交单数据 */
export interface DocumentRule extends RuleBase {
  stage: "documents";
  applicable?(ctx: { lc: LetterOfCredit; documents: PresentedText[] }): boolean;
  evaluate(ctx: { lc: LetterOfCredit; documents: PresentedText[] }): Finding[];
}

export type Rule = LcRule | PresentationRule | DocumentRule;
