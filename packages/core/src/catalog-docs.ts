/** 审证与新增审单规则的文案；占位符 {name} 取自 Finding.params */
type Entry = Record<"zh" | "en", { message: string; suggestion?: string }>;

const SOFT_SUGGEST_ZH = "这类条款的满足与否取决于申请人，可能使受益人无法单方面履约；发运前建议要求修改或删除，并保留沟通记录。";
const SOFT_SUGGEST_EN = "Whether this condition is met depends on the applicant, so you may be unable to perform on your own; before shipping, ask for it to be amended or removed and keep a record.";

export const DOC_CATALOG: Record<string, Entry> = {
  "invoice.sellerMismatch": {
    zh: { message: "发票出具人「{docName}」与信用证受益人「{lcName}」不一致", suggestion: "发票须由信用证受益人出具，请更正发票上的卖方名称。" },
    en: { message: "The invoice seller “{docName}” differs from the L/C beneficiary “{lcName}”", suggestion: "The invoice must be issued by the beneficiary; correct the seller name on the invoice." },
  },
  "invoice.sellerClose": {
    zh: { message: "发票出具人「{docName}」与受益人「{lcName}」名称相近但不完全相同", suggestion: "请核对名称是否逐字一致（含拼写、公司后缀）；银行审单对名称差异通常较严。" },
    en: { message: "The invoice seller “{docName}” is similar to, but not exactly, the beneficiary “{lcName}”", suggestion: "Check that the name matches letter for letter (spelling, company suffix); banks are usually strict about names." },
  },
  "invoice.buyerMismatch": {
    zh: { message: "发票抬头「{docName}」与信用证申请人「{lcName}」不一致", suggestion: "发票须以申请人为抬头，请更正。" },
    en: { message: "The invoice is made out to “{docName}”, not the L/C applicant “{lcName}”", suggestion: "The invoice must be made out in the name of the applicant; please correct it." },
  },
  "invoice.buyerClose": {
    zh: { message: "发票抬头「{docName}」与申请人「{lcName}」名称相近但不完全相同", suggestion: "请核对名称是否逐字一致（含拼写、公司后缀）。" },
    en: { message: "The invoice addressee “{docName}” is similar to, but not exactly, the applicant “{lcName}”", suggestion: "Check that the name matches letter for letter (spelling, company suffix)." },
  },
  "invoice.goodsMismatch": {
    zh: {
      message: "发票货物描述与信用证 45A 不相符：缺少「{missing}」（信用证描述中有 {percent}% 的词在发票里找到）",
      suggestion: "发票货描应与信用证一致；可增加不冲突的补充说明，但不得缺项，也不得改动型号、数量、规格。",
    },
    en: {
      message: "The invoice goods description does not correspond with L/C field 45A: “{missing}” is missing ({percent}% of the L/C wording was found)",
      suggestion: "The description must correspond with the credit; extra non-conflicting detail is fine, but nothing may be missing and model, quantity and specification must not change.",
    },
  },
  "insurance.currencyMismatch": {
    zh: { message: "保险单币种 {insCurrency} 与信用证币种 {lcCurrency} 不一致", suggestion: "保险单须以信用证币种出具。" },
    en: { message: "Insurance currency {insCurrency} differs from the credit currency {lcCurrency}", suggestion: "The insurance document must be in the currency of the credit." },
  },
  "insurance.needInvoiceAmount": {
    zh: { message: "缺少发票金额，无法核对投保金额是否达到要求", suggestion: "请先录入发票金额。" },
    en: { message: "The invoice amount is missing, so the insured amount cannot be checked", suggestion: "Please enter the invoice amount first." },
  },
  "insurance.amountShort": {
    zh: {
      message: "投保金额 {amount} 低于要求的 {required}（发票金额 {base} 的 {percent}%）",
      suggestion: "UCP600 要求至少为 CIF/CIP 货值的 110%（信用证另有规定的从其规定）；请要求保险公司加保或重新出单。",
    },
    en: {
      message: "The insured amount {amount} is below the required {required} ({percent}% of the invoice amount {base})",
      suggestion: "UCP600 requires at least 110% of the CIF/CIP value (or whatever the credit states); ask the insurer to increase the cover or reissue the document.",
    },
  },
  "insurance.amountShortUnknownTerm": {
    zh: {
      message: "投保金额 {amount} 低于发票金额 {base} 的 {percent}%（{required}）；信用证贸易术语不是 CIF/CIP，是否适用该要求需人工确认",
      suggestion: "请对照信用证 46A 对保险金额的具体要求核对。",
    },
    en: {
      message: "The insured amount {amount} is below {percent}% of the invoice amount {base} ({required}); the L/C trade term is not CIF/CIP, so please confirm manually whether this applies",
      suggestion: "Check against what field 46A of the credit says about the insured amount.",
    },
  },
  "insurance.dateLate": {
    zh: {
      message: "保险单日期 {insuranceDate} 晚于装运日 {shipmentDate}",
      suggestion: "保险须在装运日当天或之前生效；若保险单注明自装运日或更早日期起生效则可接受，否则需重新出具。",
    },
    en: {
      message: "The insurance document is dated {insuranceDate}, after the shipment date {shipmentDate}",
      suggestion: "Cover must be effective no later than the shipment date; it is acceptable if the document shows cover from the shipment date or earlier, otherwise it must be reissued.",
    },
  },
  "transport.portLoadingMismatch": {
    zh: { message: "运输单据装运港「{docPort}」与信用证规定的「{lcPort}」不一致", suggestion: "运输单据须显示信用证规定的装运港；如实际装运港不同，应先申请修改信用证。" },
    en: { message: "The transport document shows loading port “{docPort}”, but the credit states “{lcPort}”", suggestion: "The transport document must show the port of loading stated in the credit; if the actual port differs, ask for an amendment first." },
  },
  "transport.portDischargeMismatch": {
    zh: { message: "运输单据卸货港「{docPort}」与信用证规定的「{lcPort}」不一致", suggestion: "运输单据须显示信用证规定的卸货港；如实际卸货港不同，应先申请修改信用证。" },
    en: { message: "The transport document shows discharge port “{docPort}”, but the credit states “{lcPort}”", suggestion: "The transport document must show the port of discharge stated in the credit; if the actual port differs, ask for an amendment first." },
  },
  "transport.portGeneric": {
    zh: { message: "信用证 {field} 为泛指港口「{lcPort}」，运输单据显示「{docPort}」，请人工确认是否在允许范围内", suggestion: "泛指港口无法机械比对，请结合信用证原文判断。" },
    en: { message: "L/C field {field} names a general port (“{lcPort}”) and the transport document shows “{docPort}”; please confirm manually that it is within what is allowed", suggestion: "A general port cannot be compared mechanically; judge it against the wording of the credit." },
  },
  "lc.expiryBeforeShipment": {
    zh: { message: "信用证有效期 {expiry} 早于最迟装运日 {latest}：按最迟装运日出运将无法在有效期内交单", suggestion: "发运前请申请人修改，使有效期晚于最迟装运日，并留足交单期。" },
    en: { message: "The credit expires on {expiry}, before the latest shipment date {latest}: if you ship by the latest date, you cannot present documents within the validity", suggestion: "Before shipping, ask the applicant to amend so that expiry falls after the latest shipment date, with enough time to present." },
  },
  "lc.shortWindow": {
    zh: {
      message: "最迟装运日 {latest} 到有效期 {expiry} 只有 {window} 天，少于交单期 {days} 天：若临近最迟装运日出运，可用于交单的时间不足",
      suggestion: "尽早出运，或要求申请人修改有效期/最迟装运日，留足交单时间。",
    },
    en: {
      message: "Only {window} day(s) separate the latest shipment date {latest} from expiry {expiry}, less than the {days}-day presentation period: shipping close to the latest date leaves too little time to present",
      suggestion: "Ship early, or ask the applicant to amend the expiry or latest shipment date so there is enough time to present.",
    },
  },
  "lc.expiryPlace": {
    zh: { message: "到期地点为「{place}」：须在有效期 {expiry} 当天或之前，将单据送达该地的银行", suggestion: "到期地点在境外时，请预留国际快递时间，通常应提前数天交单。" },
    en: { message: "The credit expires at “{place}”: documents must reach the bank there on or before {expiry}", suggestion: "If that place is abroad, allow for international courier time and present several days early." },
  },
  "lc.soft.applicantDoc": {
    zh: { message: "疑似软条款：要求由申请人出具或签署的单据 ——「{snippet}」", suggestion: SOFT_SUGGEST_ZH },
    en: { message: "Possible soft clause: a document issued or signed by the applicant — “{snippet}”", suggestion: SOFT_SUGGEST_EN },
  },
  "lc.soft.applicantApproval": {
    zh: { message: "疑似软条款：需要申请人批准或同意 ——「{snippet}」", suggestion: SOFT_SUGGEST_ZH },
    en: { message: "Possible soft clause: needs the applicant's approval or consent — “{snippet}”", suggestion: SOFT_SUGGEST_EN },
  },
  "lc.soft.conditionalEffect": {
    zh: { message: "疑似软条款：信用证附条件生效 ——「{snippet}」", suggestion: SOFT_SUGGEST_ZH },
    en: { message: "Possible soft clause: the credit becomes effective only on a condition — “{snippet}”", suggestion: SOFT_SUGGEST_EN },
  },
  "lc.soft.laterAdvice": {
    zh: { message: "疑似软条款：装运细节需由申请人事后通知 ——「{snippet}」", suggestion: SOFT_SUGGEST_ZH },
    en: { message: "Possible soft clause: shipping details are to be advised by the applicant later — “{snippet}”", suggestion: SOFT_SUGGEST_EN },
  },
  "lc.soft.applicantInspection": {
    zh: { message: "疑似软条款：检验证书与申请人有关 ——「{snippet}」", suggestion: SOFT_SUGGEST_ZH },
    en: { message: "Possible soft clause: the inspection certificate involves the applicant — “{snippet}”", suggestion: SOFT_SUGGEST_EN },
  },
  "lc.burden.carrierCert": {
    zh: { message: "要求承运人 / 船东出具证明 ——「{snippet}」", suggestion: "承运人通常不会出具适航等证明，出口商无法自行取得；发运前请申请人要求开证行删除该条款。" },
    en: { message: "A certificate from the carrier or shipowner is required — “{snippet}”", suggestion: "Carriers rarely issue such certificates, so you cannot obtain one yourself; before shipping, ask the applicant to have the issuing bank delete the clause." },
  },
  "lc.burden.dispatchProof": {
    zh: { message: "要求快递收据 / 电邮副本 / 发送证明随正本单据一并提交 ——「{snippet}」", suggestion: "这属于额外的随单文件，容易漏交成为不符点；建议删除，或至少把快递改为电邮并明确无需随正本提交。" },
    en: { message: "A courier receipt, e-mail copy or dispatch proof must accompany the original documents — “{snippet}”", suggestion: "This is an extra accompanying document that is easy to miss and become a discrepancy; ask to delete it, or at least change courier to e-mail and drop the accompany requirement." },
  },
  "lc.burden.localAgentBl": {
    zh: { message: "要求提单显示孟加拉船代 / 承运人的名称、地址、电话等 ——「{snippet}」", suggestion: "使用 Master B/L 时提单上没有这些信息，会形成不符点；请要求删除，或确认船公司的提单格式能满足。" },
    en: { message: "The bill of lading must show the name, address and phone of the shipping agent or carrier in Bangladesh — “{snippet}”", suggestion: "A master B/L does not carry this information and would be discrepant; ask to delete the clause or confirm the shipping line's B/L format satisfies it." },
  },
  "lc.burden.docFormat": {
    zh: { message: "对发票 / 装箱单版式提出了细节要求（表格列头、逐项分行等）——「{snippet}」", suggestion: "版式要求越细，单据越容易出现不符点；建议要求删除这类条款，以简化信用证条款。" },
    en: { message: "Detailed layout requirements for the invoice or packing list (table columns, one row per item, etc.) — “{snippet}”", suggestion: "The more detailed the layout, the easier it is to slip into a discrepancy; ask to delete such clauses to keep the credit simple." },
  },
  "lc.spareParts": {
    zh: { message: "货物描述里写明了备品及固定数量，且信用证没有「免费货物可接受」的约定 ——「{snippet}」", suggestion: "若随货另发免费备品，发票数量会与信用证不符；请先核对备品数量，并要求在 47A 增加“随附的免费备品可接受”。" },
    en: { message: "The goods description states spare parts in a fixed quantity and the credit has no clause accepting free-of-charge goods — “{snippet}”", suggestion: "If you ship extra free spare parts the invoice quantity will not match the credit; confirm the spare-part quantity and ask for a field 47A clause accepting free-of-charge spare parts." },
  },
  "lc.dates.coverBeforeProforma": {
    zh: { message: "保险暂保单日期 {cover} 早于形式发票日期 {proforma}", suggestion: "暂保单通常在形式发票之后出具；这多半是沿用了旧暂保单，请要求申请人核对暂保单号与日期。" },
    en: { message: "The insurance cover note is dated {cover}, before the proforma invoice dated {proforma}", suggestion: "A cover note is normally issued after the proforma invoice; this often means an old cover note was reused — ask the applicant to check its number and date." },
  },
  "lc.dates.proformaAfterIssue": {
    zh: { message: "形式发票日期 {proforma} 晚于开证日 {issue}", suggestion: "开证依据的形式发票应早于开证日；请核对形式发票日期是否写错。" },
    en: { message: "The proforma invoice date {proforma} is after the issue date {issue}", suggestion: "The proforma invoice the credit relies on should predate issuance; check whether its date was written wrongly." },
  },
  "lc.dates.coverAfterIssue": {
    zh: { message: "保险暂保单日期 {cover} 晚于开证日 {issue}", suggestion: "开证时暂保单应已存在；请核对暂保单日期。" },
    en: { message: "The insurance cover note date {cover} is after the issue date {issue}", suggestion: "The cover note should already exist when the credit is issued; check its date." },
  },
  "lc.typo.letterO": {
    zh: { message: "编号「{token}」中字母 O 紧挨着数字，疑似把数字 0 写成了字母 O（应为「{suggested}」？）", suggestion: "核对该编号是否与形式发票 / 合同一致；若是笔误，发运前请求修改，否则单据上的编号会与信用证不符。" },
    en: { message: "In the reference “{token}” the letter O sits next to digits and may be a mistyped zero (should it be “{suggested}”?)", suggestion: "Check the reference against the proforma invoice or contract; if it is a typo, ask for an amendment before shipping, or the documents will not match the credit." },
  },
  "lc.typo.hyphenDecimal": {
    zh: { message: "尺寸「{token}」用连字符代替了小数点，疑似应为「{suggested}」", suggestion: "核对规格；若是笔误，请要求更正，否则单据上的写法与信用证不一致。" },
    en: { message: "The size “{token}” uses a hyphen where a decimal point is expected; it may be “{suggested}”", suggestion: "Check the specification; if it is a typo, ask for a correction, or the documents will not match the credit." },
  },
  "lc.typo.word": {
    zh: { message: "「{token}」疑似拼写笔误（应为「{suggested}」？）", suggestion: "UCP600 第 14 条 d 款允许不影响含义的拼写差异，但货物描述里的错字仍建议更正，以免银行审单时产生争议。" },
    en: { message: "“{token}” may be a spelling slip (should it be “{suggested}”?)", suggestion: "UCP 600 Art. 14(d) tolerates typos that do not change the meaning, but it is still safer to correct them in the goods description to avoid disputes at examination." },
  },
  "lc.dates.proformaStale": {
    zh: { message: "形式发票日期 {proforma} 比开证日 {issue} 早了 {days} 天", suggestion: "间隔较长，请确认形式发票上的价格和条款仍然有效；必要时请申请人重新出具。" },
    en: { message: "The proforma invoice dated {proforma} is {days} days older than the issue date {issue}", suggestion: "That is a long gap; confirm the prices and terms on the proforma invoice are still valid, and ask the applicant for a new one if needed." },
  },
  "lc.placeholder": {
    zh: { message: "条款里仍有未填写的占位符 ——「{snippet}」", suggestion: "占位符（如 MC-XXXX、XXXX）须在正本中填成真实内容；请要求开证行补全后再备货。" },
    en: { message: "An unfilled placeholder remains in the text — “{snippet}”", suggestion: "Placeholders such as MC-XXXX must be replaced with real values in the issued credit; ask the issuing bank to complete them before you prepare the goods." },
  },
  "country.hit": {
    zh: { message: "开证行所在国家：{countryZh}（{country}）{stateZh}。该国的要求：{reqZh}。{note}", suggestion: "发运前对照这些要求逐项确认；国别规则由你们公司维护，可在“国别规则”中修改。" },
    en: { message: "Issuing bank country: {countryEn} ({country}){stateEn}. Requirements: {reqEn}. {note}", suggestion: "Check each requirement before shipping; the country rules are maintained by your company under “Country rules”." },
  },
  "country.unknown": {
    zh: { message: "未能从 52A 识别开证行所在国家，国别规则未检查", suggestion: "请人工确认开证行所在国家，并对照“国别规则”。" },
    en: { message: "The issuing bank country could not be read from field 52A, so country rules were not checked", suggestion: "Confirm the issuing bank country manually and compare it with the country rules." },
  },
  "carrierBl.forwarder": {
    zh: { message: "要求提交船东单（来源：{sourceZh}），但提单的签发人看起来是货代：{issuer}", suggestion: "货代提单（House B/L）可能被银行当作不符点。请改用船公司（承运人）签发的提单，或在发运前要求申请人修改该条款。" },
    en: { message: "A carrier-issued bill of lading is required (source: {sourceEn}), but the issuer looks like a forwarder: {issuer}", suggestion: "A forwarder (house) bill of lading may be refused by the bank. Use a bill of lading issued by the shipping line (carrier), or ask the applicant to amend the clause before shipment." },
  },
  "carrierBl.confirm": {
    zh: { message: "要求提交船东单（来源：{sourceZh}），但无法确认提单是否由承运人签发（当前记录：{issuer}）", suggestion: "请对照提单签章确认签发人和签发身份（as carrier / master 等），并把它们录入运输单据数据。" },
    en: { message: "A carrier-issued bill of lading is required (source: {sourceEn}), but it cannot be confirmed that the bill was issued by the carrier (recorded: {issuer})", suggestion: "Check the signature block of the bill of lading for the issuer and capacity (as carrier / master, etc.) and enter them in the transport document data." },
  },
};
