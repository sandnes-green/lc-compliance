import type { Lang, Severity } from "@lc/core";

export interface ReportStrings {
  title: string;
  subtitle: string;
  meta: { case: string; lc: string; generated: string; checkedAt: string; ruleset: string };
  sections: { summary: string; lcFacts: string; presentation: string; lcFindings: string; docFindings: string; actions: string; coverage: string; errors: string; disclaimer: string };
  severity: Record<Severity, string>;
  headline: {
    discrepancies: string; // {n}
    risks: string; // {n}
    doubts: string; // {n}
    clean: string;
    noPresentation: string;
  };
  coverageLine: string; // {checked} {skipped}
  sectionClean: string;
  noPresentationData: string;
  basis: string; // {clause} {ruleId}
  basisCustom: string; // {source}
  userDefined: string;
  suggestion: string;
  evidenceCols: { source: string; field: string; value: string };
  documents: { lc: string; invoice: string; transport: string; insurance: string; manual: string; policy: string };
  coverageStatus: { passed: string; issues: string; skipped: string; legacy: string };
  actionGroups: { lc: string; timing: string; invoice: string; transport: string; insurance: string };
  actionsEmpty: string;
  facts: {
    reference: string; form: string; issueDate: string; amount: string; tolerance: string; expiry: string; latestShipment: string;
    presentationPeriod: string; days: string; defaultDays: string; applicant: string; beneficiary: string; portOfLoading: string; portOfDischarge: string;
    partial: string; transhipment: string; goods: string; documents: string; conditions: string;
    presentationDate: string; sellerName: string; buyerName: string; goodsDescription: string; currency: string; invoiceAmount: string; shipmentDate: string;
    insuredAmount: string; insuranceDate: string; issuerName: string; signingCapacity: string;
  };
  docGroups: { invoice: string; transport: string; insurance: string; general: string };
  disclaimer: string[];
}

export const REPORT_STRINGS: Record<Lang, ReportStrings> = {
  zh: {
    title: "信用证合规自查报告",
    subtitle: "出口交单前自查",
    meta: { case: "案件", lc: "信用证号", generated: "报告生成时间", checkedAt: "审查时间", ruleset: "规则库版本" },
    sections: {
      summary: "一、结论摘要",
      lcFacts: "二、信用证要素",
      presentation: "三、本次审查所用的单据数据",
      lcFindings: "四、审证：信用证本身",
      docFindings: "五、审单：拟交单据",
      actions: "六、修改清单",
      coverage: "七、检查清单",
      errors: "规则执行异常",
      disclaimer: "八、说明与免责声明",
    },
    severity: { discrepancy: "不符点", risk: "风险", doubt: "疑点", info: "提示" },
    headline: {
      discrepancies: "发现 {n} 项不符点。建议修改相关单据（或与申请人沟通修改信用证）后再交单，否则银行有权拒付。",
      risks: "未发现单据不符点，但信用证存在 {n} 项风险。建议发运前与申请人确认或要求修改信用证。",
      doubts: "有 {n} 项疑点无法自动判断，请人工核对后再交单。",
      clean: "已检查的规则项未发现问题。这不代表单据完全合规，请结合下方检查清单理解。",
      noPresentation: "尚未录入交单数据，本报告仅包含审证结果。",
    },
    coverageLine: "共 {checked} 项规则已检查，{skipped} 项因缺少数据未检查。",
    sectionClean: "该部分未发现问题。",
    noPresentationData: "未录入交单数据。",
    basis: "依据：{clause}（规则 {ruleId}）",
    basisCustom: "依据：自定义检查项（出处：{source}）",
    userDefined: "手工添加",
    suggestion: "建议",
    evidenceCols: { source: "来源", field: "字段", value: "值" },
    documents: { lc: "信用证", invoice: "发票", transport: "运输单据", insurance: "保险单据", manual: "手册依据", policy: "国别规则" },
    coverageStatus: { passed: "已检查，未发现问题", issues: "已检查，发现 {n} 项", skipped: "未检查：缺少所需数据", legacy: "旧版记录，无检查清单" },
    actionGroups: {
      lc: "信用证 / 与申请人沟通",
      timing: "交单安排",
      invoice: "商业发票",
      transport: "运输单据",
      insurance: "保险单据",
    },
    actionsEmpty: "没有需要修改的事项。",
    facts: {
      reference: "信用证号", form: "类型 (40A)", issueDate: "开立日期", amount: "币种与金额", tolerance: "金额容差 (39A)", expiry: "有效期 / 地点",
      latestShipment: "最迟装运日", presentationPeriod: "交单期 (48)", days: "{n} 天", defaultDays: "未规定（按 21 天）", applicant: "申请人", beneficiary: "受益人",
      portOfLoading: "装运港", portOfDischarge: "卸货港", partial: "分批装运 (43P)", transhipment: "转运 (43T)", goods: "货物描述 (45A)",
      documents: "单据要求 (46A)", conditions: "附加条件 (47A)",
      presentationDate: "拟交单日期", sellerName: "卖方（出具人）", buyerName: "买方（抬头）", goodsDescription: "货物描述", currency: "币种", invoiceAmount: "金额",
      shipmentDate: "装运日期", insuredAmount: "投保金额", insuranceDate: "保险单日期", issuerName: "提单签发人", signingCapacity: "签发身份",
    },
    docGroups: { invoice: "商业发票", transport: "运输单据", insurance: "保险单据", general: "交单信息" },
    disclaimer: [
      "本报告由软件依据 UCP 600 等规则自动生成，仅供出口企业交单前自查参考，不构成法律意见，也不代表银行的审单结论。银行以其实际审核为准。",
      "「疑点」和「风险」是软件无法确定或需要结合业务判断的事项，须由有单证经验的人员复核。规则库未覆盖的项目（如装箱单、原产地证、汇票、正本份数等）未被检查。",
      "单据数据若来自 OCR 或 AI 抽取，可能存在识别错误，使用前须对照原件核对。",
    ],
  },
  en: {
    title: "L/C Compliance Self-Check Report",
    subtitle: "Pre-presentation check for exporters",
    meta: { case: "Case", lc: "L/C No.", generated: "Report generated", checkedAt: "Checked at", ruleset: "Rule set" },
    sections: {
      summary: "1. Summary",
      lcFacts: "2. Letter of credit terms",
      presentation: "3. Document data used in this check",
      lcFindings: "4. L/C review: the credit itself",
      docFindings: "5. Document check: documents to present",
      actions: "6. Action list",
      coverage: "7. Checklist",
      errors: "Rule execution errors",
      disclaimer: "8. Notes and disclaimer",
    },
    severity: { discrepancy: "Discrepancy", risk: "Risk", doubt: "To verify", info: "Note" },
    headline: {
      discrepancies: "{n} discrepancy(ies) found. Correct the documents (or ask the applicant to amend the credit) before presenting, otherwise the bank may refuse.",
      risks: "No document discrepancies found, but the credit carries {n} risk(s). Confirm with the applicant or ask for an amendment before shipping.",
      doubts: "{n} item(s) could not be judged automatically; please verify them manually before presenting.",
      clean: "The rules that were checked found nothing. This does not mean the documents are fully compliant; read it together with the checklist below.",
      noPresentation: "No presented-document data has been entered, so this report covers the L/C review only.",
    },
    coverageLine: "{checked} rule(s) checked; {skipped} not checked for lack of data.",
    sectionClean: "Nothing found in this section.",
    noPresentationData: "No document data entered.",
    basis: "Basis: {clause} (rule {ruleId})",
    basisCustom: "Basis: custom check item (source: {source})",
    userDefined: "added by hand",
    suggestion: "Suggestion",
    evidenceCols: { source: "Source", field: "Field", value: "Value" },
    documents: { lc: "L/C", invoice: "Invoice", transport: "Transport doc", insurance: "Insurance doc", manual: "Manual source", policy: "Country rule" },
    coverageStatus: { passed: "Checked, nothing found", issues: "Checked, {n} finding(s)", skipped: "Not checked: required data missing", legacy: "Older record without a checklist" },
    actionGroups: {
      lc: "Letter of credit / talk to the applicant",
      timing: "Presentation timing",
      invoice: "Commercial invoice",
      transport: "Transport document",
      insurance: "Insurance document",
    },
    actionsEmpty: "Nothing needs to be changed.",
    facts: {
      reference: "L/C No.", form: "Form (40A)", issueDate: "Date of issue", amount: "Currency & amount", tolerance: "Tolerance (39A)", expiry: "Expiry / place",
      latestShipment: "Latest shipment date", presentationPeriod: "Presentation period (48)", days: "{n} days", defaultDays: "Not stated (21 days applies)", applicant: "Applicant", beneficiary: "Beneficiary",
      portOfLoading: "Port of loading", portOfDischarge: "Port of discharge", partial: "Partial shipments (43P)", transhipment: "Transhipment (43T)", goods: "Goods (45A)",
      documents: "Documents required (46A)", conditions: "Additional conditions (47A)",
      presentationDate: "Planned presentation date", sellerName: "Seller (issuer)", buyerName: "Buyer (addressee)", goodsDescription: "Goods description", currency: "Currency", invoiceAmount: "Amount",
      shipmentDate: "Shipment date", insuredAmount: "Insured amount", insuranceDate: "Insurance document date", issuerName: "B/L issuer", signingCapacity: "Signing capacity",
    },
    docGroups: { invoice: "Commercial invoice", transport: "Transport document", insurance: "Insurance document", general: "Presentation" },
    disclaimer: [
      "This report is generated automatically by software from UCP 600 and related rules. It is meant only as a pre-presentation self-check for exporters, is not legal advice, and is not the bank's examination result. The bank's own examination prevails.",
      "“To verify” and “Risk” items are ones the software cannot settle or that need business judgement; they must be reviewed by someone experienced in documentary credits. Items the rule set does not cover (such as packing list, certificate of origin, draft, number of originals) were not checked.",
      "If document data came from OCR or AI extraction it may contain errors; check it against the originals before relying on it.",
    ],
  },
};
