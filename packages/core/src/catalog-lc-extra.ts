/** 审证补充规则（rules/lcExtra.ts）的文案；占位符 {name} 取自 Finding.params */
type Entry = Record<"zh" | "en", { message: string; suggestion?: string }>;

const SHIP_CONFLICT_SUGGEST_ZH = "请要求申请人修改，使字段与条款文字一致；在澄清之前，按更严格的一方执行。";
const SHIP_CONFLICT_SUGGEST_EN = "Ask the applicant to amend so the field and the wording agree; until it is clarified, follow the stricter of the two.";

export const LC_EXTRA_CATALOG: Record<string, Entry> = {
  "lc.tolerance.oneSided": {
    zh: { message: "39A 容差不对称：+{plus}% / -{minus}%，其中一侧为 0", suggestion: "按限制的一侧备货和开票：为 0 的一侧不允许浮动，超出即构成不符点。" },
    en: { message: "The tolerance in 39A is one-sided: +{plus}% / -{minus}%, with one side at zero", suggestion: "Plan the shipment and invoice around the restricted side: no variation is allowed on the zero side, and going beyond it is a discrepancy." },
  },
  "lc.tolerance.large": {
    zh: { message: "39A 容差为 +{plus}% / -{minus}%，超过常见的 10%", suggestion: "请与申请人确认是否笔误；容差过大时金额与数量的控制口径容易出现分歧。" },
    en: { message: "The tolerance in 39A is +{plus}% / -{minus}%, above the usual 10%", suggestion: "Confirm with the applicant that this is not a typing error; a wide tolerance makes the amount and quantity limits easy to dispute." },
  },
  "lc.tolerance.aboutStacked": {
    zh: {
      message: "货物描述里有「约」的用语（{snippet}），同时 39A 又规定了容差：两者如何叠加不明确",
      suggestion: "UCP600 第 30 条 a 款：「约」允许金额、数量、单价上下 10%。与 39A 并存时口径不清，建议按较严格的一方备货，或要求申请人澄清。",
    },
    en: {
      message: "The goods description uses “about”-type wording ({snippet}) and 39A also states a tolerance: how the two combine is unclear",
      suggestion: "Under UCP600 Art.30(a), “about” allows 10% on the amount, quantity and unit price. With 39A as well the basis is unclear; plan to the stricter one or ask the applicant to clarify.",
    },
  },
  "lc.tolerance.discreteUnits": {
    zh: {
      message: "数量以套 / 件等计数单位表示（{snippet}），且信用证没有容差约定",
      suggestion: "UCP600 第 30 条 b 款的 ±5% 数量容差不适用于以包装单位或个数计的数量，须足额装运；如需浮动，请申请人在 39A 增加容差或在货描加「约」。",
    },
    en: {
      message: "The quantity is stated in sets, pieces or other countable units ({snippet}) and the credit gives no tolerance",
      suggestion: "The ±5% quantity tolerance of UCP600 Art.30(b) does not apply to a quantity stated in packing units or individual items, so ship the full quantity; if some give is needed, ask the applicant to add a tolerance in 39A or “about” in the description.",
    },
  },
  "lc.partial.notAllowed": {
    zh: {
      message: "信用证不允许分批装运（43P）",
      suggestion: "全部货物须一次装运。同一运输工具、同一航程、同一目的地的多次装运不视为分批（UCP600 第 31 条 b 款）；备货无法一次完成时，请先申请修改。",
    },
    en: {
      message: "The credit does not allow partial shipments (43P)",
      suggestion: "All the goods must go in one shipment. Shipments on the same conveyance, same journey and same destination are not partial (UCP600 Art.31(b)); if you cannot be ready in one go, ask for an amendment first.",
    },
  },
  "lc.tranship.notAllowed": {
    zh: {
      message: "信用证不允许转运（43T）",
      suggestion: "请订直达航线。集装箱、拖车或子船运输且提单已注明时，提单显示将转运仍可接受（UCP600 第 20 条 c 款 ii 项），订舱前请与船公司确认提单批注。",
    },
    en: {
      message: "The credit does not allow transhipment (43T)",
      suggestion: "Book a direct service. For goods shipped in a container, trailer or LASH barge as evidenced by the bill of lading, one showing that transhipment will or may take place is acceptable (UCP600 Art.20(c)(ii)); confirm the B/L wording with the carrier before booking.",
    },
  },
  "lc.partial.conditional": {
    zh: { message: "分批装运（43P）为 CONDITIONAL，具体条件要看 47A 等条款文字", suggestion: "逐条核对附加条件；条件不清楚的，发运前请申请人澄清或修改。" },
    en: { message: "Partial shipments (43P) is CONDITIONAL; the conditions are in the clause text such as 47A", suggestion: "Check the additional conditions one by one; if they are unclear, have the applicant clarify or amend before shipping." },
  },
  "lc.tranship.conditional": {
    zh: { message: "转运（43T）为 CONDITIONAL，具体条件要看 47A 等条款文字", suggestion: "逐条核对附加条件；条件不清楚的，发运前请申请人澄清或修改。" },
    en: { message: "Transhipment (43T) is CONDITIONAL; the conditions are in the clause text such as 47A", suggestion: "Check the additional conditions one by one; if they are unclear, have the applicant clarify or amend before shipping." },
  },
  "lc.partial.conflict": {
    zh: { message: "43P（分批装运）为「{field}」，但条款文字又写 ——「{snippet}」，前后矛盾", suggestion: SHIP_CONFLICT_SUGGEST_ZH },
    en: { message: "43P (partial shipments) says “{field}”, but the clause text says — “{snippet}”: the two contradict each other", suggestion: SHIP_CONFLICT_SUGGEST_EN },
  },
  "lc.tranship.conflict": {
    zh: { message: "43T（转运）为「{field}」，但条款文字又写 ——「{snippet}」，前后矛盾", suggestion: SHIP_CONFLICT_SUGGEST_ZH },
    en: { message: "43T (transhipment) says “{field}”, but the clause text says — “{snippet}”: the two contradict each other", suggestion: SHIP_CONFLICT_SUGGEST_EN },
  },
  "lc.presentation.daysConflict": {
    zh: {
      message: "48 字段规定交单期为 {fieldDays} 天，但条款文字里写的是 {textDays} 天 ——「{snippet}」",
      suggestion: "两处交单期不一致时银行可能按较短的一方审单；请要求申请人修改使其一致，在此之前按较短的一方安排交单。",
    },
    en: {
      message: "Field 48 sets the presentation period at {fieldDays} days, but the clause text says {textDays} days — “{snippet}”",
      suggestion: "With two different periods a bank may apply the shorter; ask the applicant to amend them to agree, and plan to present within the shorter one meanwhile.",
    },
  },
  "lc.expiry.textConflict": {
    zh: {
      message: "31D 的到期日是 {expiry}，但条款文字里又出现另一个到期日 {textDate} ——「{snippet}」（双到期）",
      suggestion: "按更早的日期安排交单，并要求申请人修改，只保留一个到期日。",
    },
    en: {
      message: "Field 31D expires on {expiry}, but the clause text names another expiry date, {textDate} — “{snippet}” (double expiry)",
      suggestion: "Plan to present by the earlier date and ask the applicant to amend so that only one expiry date remains.",
    },
  },
  "lc.form.missing": {
    zh: { message: "没有读到 40A（信用证类型）", suggestion: "请对照报文原文确认是否为不可撤销信用证；解析不出时可检查导入的文本。" },
    en: { message: "Field 40A (form of credit) was not found", suggestion: "Check the original message to confirm the credit is irrevocable; if parsing failed, check the imported text." },
  },
  "lc.form.revocable": {
    zh: { message: "40A 显示为可撤销信用证：{form}", suggestion: "UCP600 下信用证均为不可撤销；可撤销的信用证随时可被修改或撤销而无需通知受益人，发运前请要求改为不可撤销。" },
    en: { message: "Field 40A shows a revocable credit: {form}", suggestion: "Credits under UCP600 are irrevocable; a revocable credit can be amended or cancelled without notice to you, so ask for it to be made irrevocable before shipping." },
  },
  "lc.form.transferable": {
    zh: { message: "40A 显示为可转让信用证：{form}", suggestion: "若你是第一受益人，转让须经指定银行办理；若你是第二受益人，请核对转让后的金额、单价、有效期与最迟装运日是否被缩减。" },
    en: { message: "Field 40A shows a transferable credit: {form}", suggestion: "If you are the first beneficiary, the transfer must go through the nominated bank; if you are the second, check the transferred amount, unit price, expiry and latest shipment date, which may have been reduced." },
  },
  "lc.form.standby": {
    zh: { message: "40A 显示为备用信用证：{form}", suggestion: "备用证通常适用 ISP98 或 UCP600，单据要求与跟单信用证不同，本工具的审单规则按跟单信用证设计，请以人工判断为准。" },
    en: { message: "Field 40A shows a standby credit: {form}", suggestion: "A standby usually follows ISP98 or UCP600 and its document requirements differ from a documentary credit; the presentation rules here are designed for documentary credits, so rely on manual judgment." },
  },
  "lc.rules.missing": {
    zh: { message: "没有读到 40E（适用规则）", suggestion: "信用证应注明适用规则（如 UCP LATEST VERSION）；请对照报文原文，缺失时要求开证行补充。" },
    en: { message: "Field 40E (applicable rules) was not found", suggestion: "A credit should state the rules that apply (for example UCP LATEST VERSION); check the original message, and ask the issuing bank to add it if missing." },
  },
  "lc.rules.nonUcp": {
    zh: { message: "40E 适用规则为 {rules}，不是 UCP", suggestion: "ISP98、URDG 等规则下的审单标准与 UCP600 不同，本工具的审单规则可能不适用，请以人工判断为准。" },
    en: { message: "Field 40E names {rules}, not UCP", suggestion: "Under ISP98, URDG and similar rules the examination standard differs from UCP600, so the presentation rules here may not apply; rely on manual judgment." },
  },
  "lc.rules.other": {
    zh: { message: "40E 适用规则为 OTHR（其他规则）：{rules}", suggestion: "适用规则不明确，银行审单的依据无从核对；请要求开证行明确改为 UCP LATEST VERSION，或写明具体规则。" },
    en: { message: "Field 40E is OTHR (other rules): {rules}", suggestion: "The governing rules are not clear, so you cannot tell what the bank will examine against; ask the issuing bank to state UCP LATEST VERSION or the specific rules." },
  },
  "lc.rules.unknown": {
    zh: { message: "40E 适用规则的写法无法识别：{rules}", suggestion: "请对照报文原文确认适用规则。" },
    en: { message: "The wording in 40E could not be recognised: {rules}", suggestion: "Check the original message to confirm the rules that apply." },
  },
  "lc.rules.oldUcp": {
    zh: { message: "条款文字引用了已被取代的 UCP 500 ——「{snippet}」", suggestion: "UCP500 已被 UCP600 取代；与 40E 并存会让适用规则不明，请要求更正为 UCP600。" },
    en: { message: "The clause text refers to UCP 500, which has been superseded — “{snippet}”", suggestion: "UCP 500 was replaced by UCP 600; together with 40E it leaves the applicable rules unclear, so ask for it to be corrected to UCP 600." },
  },
};
