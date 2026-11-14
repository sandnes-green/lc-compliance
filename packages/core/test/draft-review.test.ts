import { describe, expect, it } from "vitest";
import {
  allianceToSwift,
  allRules,
  burdensomeClauses,
  dateCoherence,
  letterOTypo,
  localizeFinding,
  parseMt700,
  placeholders,
  RULE_TITLES,
  spareParts,
  splitSwiftFields,
  typoWords,
} from "../src";
import type { LetterOfCredit } from "../src";

/** 取自样本 003 初稿的写法：标签行带标题、值在下一行；金额与名称为合成数据 */
const DRAFT_003 = `:27: SEQUENCE OF TOTAL
1/1
:20: DOCUMENTARY CREDIT NUMBER
411012647150-S
:31C: DATE OF ISSUE
260625
:31D: DATE AND PLACE OF EXPIRY
260915HONGKONG
:32B: CURRENCY CODE, AMOUNT
USD80049,50
:44C: LATEST DATE OF SHIPMENT
260824
:45A: DESCRIPTION OF GOODS AND/OR SERVICES
+VALUE-TOP COMPUTER MONITOR :
1. COMPUTER MONITOR 21.5-INCH
QUANTITY: 2520 UNIT
2. 21.5-INCH MONITOR PANEL AS SPARE PARTS
QUANTITY: 40 UNIT
:46A: DOCUMENTS REQUIRED
+ BENEFICIARY'S SIGNED INVOICES (1 ORIGINAL AND 5 COPIES) AND INVOICE MUST MENTION THE BELOW:
A) PROFORMA INVOICE NUMBER AND DATE: CCTO6O331
23.06.2026
G) INSURANCE COVER NOTE NUMBER AND DATE:
SAIC/DIL/MC-XXXX/06/2026 DT.18.06.2026
.
+ SHIPMENT TO BE EFFECTED PER LINER VESSEL WHICH MUST SEAWORTHY,
A CERTIFICATE TO THIS EFFECT FROM THE CARRIER OR THEIR AGENT MUST
ACCOMPANY THE ORIGINAL SHIPPING DOCUMENTS.
.
+ THE BENEFICIARY IS REQUIRED TO SEND ONE SET OF NON-NEGOTIABLE
SHIPPING DOCUMENTS DIRECT TO THE APPLICANT BY COURIER SERVICE AND
THE RELEVANT COURIER RECEIPT MUST ACCOMPANY THE ORIGINAL SHIPPING
DOCUMENTS.
:47A: ADDITIONAL CONDITIONS
+ ALL DOCUMENTS MUST BE ISSUED IN ENGLISH LANGUAGE.
:48: PERIOD FOR PRESENTATION IN DAYS
021/AFTER THE DATE OF SHIPMENT
`;

const lcOf = (patch: Partial<LetterOfCredit> = {}): LetterOfCredit => ({ ...parseMt700(DRAFT_003), ...patch });
const codes = (fs: { code: string }[]) => fs.map((f) => f.code);

describe("银行系统导出格式的解析", () => {
  const lc = parseMt700(DRAFT_003);
  it("标签行上的字段标题不混进字段值", () => {
    expect(lc.reference).toBe("411012647150-S");
    expect(lc.issueDate).toBe("2026-06-25");
    expect(lc.expiryDate).toBe("2026-09-15");
    expect(lc.expiryPlace).toBe("HONGKONG");
    expect(lc.latestShipmentDate).toBe("2026-08-24");
    expect(lc.goodsDescription?.startsWith("+VALUE-TOP")).toBe(true);
  });
  it("草稿金额未填（USDXXXXX,XX）时仍可建案，并提示占位符", () => {
    const masked = parseMt700(DRAFT_003.replace("USD80049,50", "USDXXXXX,XX"));
    expect(masked.currency).toBe("USD");
    expect(masked.amount).toBe(0);
    expect(masked.amountMasked).toBe(true);
    const fs = placeholders.evaluate({ lc: masked });
    expect(fs.some((f) => f.evidence[0]!.field === "32B")).toBe(true);
    // 真正的格式错误仍然报错
    expect(() => parseMt700(":20:X\n:32B:USDABC")).toThrow(/32B/);
    expect(lc.amountMasked).toBeUndefined();
  });
  it("Word 导出的写法：标签在上一行末尾、标题与值同一行（样本 003 修改建议.docx）", () => {
    const w = parseMt700(`:27:      SEQUENCE OF TOTAL       DATE: 25,JUNE,2026 1/1
:40A:     FORM OF DOCUMENTARY CREDIT IRREVOCABLE
:20:      DOCUMENTARY CREDIT NUMBER 411012647150-S
:31C:     DATE OF ISSUE 260625
:31D:     DATE AND PLACE OF EXPIRY 260915HONGKONG
:50:      APPLICANT
XXXXXXXXXXXXXXXX5
BANGLADESH
:59:      BENEFICIARY
CXXXXXXXXXXXXXXX:32B:     CURRENCY CODE, AMOUNT
USDXXXXXX
:41D:   AVAILABLE WITH     BY
ANY BANK
BY NEGOTIATION
:42C:     DRAFTS AT
DRAFT AT SIGHT IN DUPLICATE :42A:     DRAWEE
SCBLBDDXXXX
:43T:    TRANSHIPMENT ALLOWED
:44F:     PORT OF DISCHARGE/AIRPORT OF DESTINATION
CHATTOGRAM SEAPORT, BANGLADESH :44C:     LATEST DATE OF SHIPMENT
260824
:48:      PERIOD FOR PRESENTATION IN DAYS 021/AFTER THE DATE OF SHIPMENT`);
    expect(w.reference).toBe("411012647150-S");
    expect(w.form).toBe("IRREVOCABLE");
    expect(w.issueDate).toBe("2026-06-25");
    expect(w.expiryDate).toBe("2026-09-15");
    expect(w.expiryPlace).toBe("HONGKONG");
    expect(w.currency).toBe("USD");
    expect(w.amountMasked).toBe(true); // USDXXXXXX（没有逗号）
    expect(w.applicantName).toBe("XXXXXXXXXXXXXXXX5");
    expect(w.beneficiaryName).toBe("CXXXXXXXXXXXXXXX");
    expect(w.transhipment).toBe("ALLOWED");
    expect(w.portOfDischarge).toBe("CHATTOGRAM SEAPORT, BANGLADESH");
    expect(w.latestShipmentDate).toBe("2026-08-24");
    expect(w.presentationDays).toBe(21);
    expect(w.raw["42C"]).toBe("DRAFT AT SIGHT IN DUPLICATE");
  });
  it("样本 004 的写法：标题大小写混合，金额 USD101800,", () => {
    const w = parseMt700(`:20: Documentary Credit Number
001CI01260320001
:50: Applicant
Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:59: Beneficiary
Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx:32B: Currency Code, Amount
USD101800,
:44C: Latest Date of Shipment
260410
:48: Period for
Presentation in Days
21/DAYS FROM THE DATE OF SHIPMENT`);
    expect(w.reference).toBe("001CI01260320001");
    expect(w.amount).toBe(101800);
    expect(w.amountMasked).toBeUndefined();
    expect(w.latestShipmentDate).toBe("2026-04-10");
    expect(w.presentationDays).toBe(21); // 标题折成两行也能读到
  });
  it("日期值前夹着浏览器打印的页脚时仍能读到日期（样本 004 的最迟装运日）", () => {
    const w = parseMt700(`:20: X
:32B: Currency Code, Amount
USD101800,
:31D: Date and Place of Expiry
260501HONG KONG
:44C: Latest Date of Shipment
1 of 4                                         01/02/2026, 6:13 pm


260410
:45A: Description of Goods and/or Services
+VALUE TOP COMPUTER MONITOR`);
    expect(w.latestShipmentDate).toBe("2026-04-10");
    expect(w.expiryDate).toBe("2026-05-01");
    expect(w.expiryPlace).toBe("HONG KONG");
    expect(w.raw["44C"]).toBe("260410"); // 页脚不进字段值
  });
  it("SWIFT Alliance 导出格式（样本 002 初稿）：F 标签、子字段标签、错乱的 32B、页脚与报告尾部", () => {
    const w = parseMt700(`Report Header
Application: Alliance Message Management
Message Text
F27: Sequence of Total
Number: 1/
Total: 1
F40A: Form of Documentary Credit
IRREVOCABLE
F20: Documentary Credit Number
8526014071-1
F31C: Date of Issue
261013 2026 Oct 13
F40E: Applicable Rules
Applicable Rules: UCP LATEST VERSION
F31D: Date and Place of Expiry
Date: 270110 2027 Jan 10
Place: HONG KONG
F50: Applicant
XXXXXXXXXXXXXXXXXXXXXXX
XXXXXXXXX
    F59: Beneficiary
Page 1 of    4
Name and Address: XXXXXXXXXXXXXXXXXXXXXXXXXX
XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
F32B: Currency Code, Amount
Currency:
Amount:
USD
XXXXX,
US DOLLAR
#XXXXXX,#
F41D: Available With ... By ... - Name and Address - Code
Name and Address: ANY BANK IN HONG KONG
Code: BY NEGOTIATION
F42C: Drafts at ...
AT SIGHT
F42A: Drawee - Party Identifier - Identifier Code
Identifier Code: BRAKBDDHXXX BRAC BANK PLC
DHAKA BD
F43P: Partial Shipments
ALLOWED
F44C: Latest Date of Shipment
261220 2026 Dec 20
F45A: Description of Goods and/or Services
1. BENEFICIARY'S SIGNED INVOICES (1 ORIGINAL + 5 COPIES)
2. PACKING LIST ONE ORIGINAL PLUS TWO COPIES
3. CERTIFICATE OF ORIGIN IN 03 COPIES
4.FULL SET OF CLEAN 'SHIPPED ON BOARD' MARINE BILL OF LADING
F46A: Documents Required
F47A: Additional Conditions
1. ALL SHIPPING DOCUMENTS MUST BEAR THE L/C NUMBER AND DATE
F71D: Charges
ALL CHARGES OUTSIDE BANGLADESH
F48: Period for Presentation in Days
Days: 21
Narrative: /WITHIN THE VALIDITY OF THE CREDIT
F72Z: Sender to Receiver Information
PLEASE ADVISE TO BENIFICIARY AND
Network Data
Network: SWIFT
End of Message
Report Footer`);
    expect(w.reference).toBe("8526014071-1");
    expect(w.issueDate).toBe("2026-10-13");
    expect(w.expiryDate).toBe("2027-01-10");
    expect(w.expiryPlace).toBe("HONG KONG");
    expect(w.currency).toBe("USD");
    expect(w.amountMasked).toBe(true);
    expect(w.latestShipmentDate).toBe("2026-12-20");
    expect(w.presentationDays).toBe(21);
    expect(w.raw["40E"]).toBe("UCP LATEST VERSION");
    expect(w.applicantName).toMatch(/^X+$/);
    expect(w.beneficiaryName).toMatch(/^X+$/); // "Name and Address:" 子字段标签已去掉
    expect(w.raw["41D"]).toBe("ANY BANK IN HONG KONG\nBY NEGOTIATION");
    expect(w.raw["42A"]!.startsWith("BRAKBDDHXXX BRAC BANK PLC")).toBe(true);
    expect(w.raw["72Z"]).toBe("PLEASE ADVISE TO BENIFICIARY AND"); // 报告尾部不进字段
    expect(w.documentsRequired).toBe(""); // 46A 标题后面直接是下一个字段：值为空，不会把下一个字段吞进来
    expect(w.additionalConditions).toBe("1. ALL SHIPPING DOCUMENTS MUST BEAR THE L/C NUMBER AND DATE");
  });
  it("Alliance 格式里的金额写成数字时正常读取；标准写法的报文不受影响", () => {
    const w = parseMt700("F20: Documentary Credit Number\nX1\nF32B: Currency Code, Amount\nCurrency: USD US DOLLAR\nAmount: 100000,50 #100,000.50#\nF48: Period\nDays: 30");
    expect(w.amount).toBe(100000.5);
    expect(w.amountMasked).toBeUndefined();
    expect(allianceToSwift(DRAFT_003)).toBe(DRAFT_003);
  });
  it("行中间不是已知标签的冒号数字不会被当成标签", () => {
    const f = splitSwiftFields(":79:AT 12:30:45 TODAY AND REF :99: HERE\n:20:X");
    expect(f["79"]).toBe("AT 12:30:45 TODAY AND REF :99: HERE");
    expect(Object.keys(f).sort()).toEqual(["20", "79"]);
  });
  it("交单期读 nnn/说明 的写法", () => {
    expect(lc.presentationDays).toBe(21);
    const days = (v: string) => parseMt700(`:20:X\n:32B:USD1,00\n:48:${v}`).presentationDays;
    expect(days("20/WITHIN THE VALIDITY OF THE CREDIT")).toBe(20);
    expect(days("21/DAYS FROM THE DATE OF SHIPMENT")).toBe(21);
    expect(days("30 DAYS AFTER SHIPMENT")).toBe(30);
  });
});

describe("LCR-BURDENSOME-CLAUSES（样本 003/004 的删除建议）", () => {
  it("003：承运人适航证明、快递收据随单", () => {
    const fs = burdensomeClauses.evaluate({ lc: lcOf() });
    expect(codes(fs)).toEqual(["lc.burden.carrierCert", "lc.burden.dispatchProof"]);
    expect(fs[0]!.severity).toBe("risk");
    expect(fs[1]!.severity).toBe("doubt");
    expect(fs[1]!.evidence[0]!.field).toBe("46A");
  });
  it("证据取整条条款，不从单词中间截断", () => {
    const fs = burdensomeClauses.evaluate({ lc: lcOf() });
    expect(fs[0]!.evidence[0]!.value).toBe(
      "SHIPMENT TO BE EFFECTED PER LINER VESSEL WHICH MUST SEAWORTHY, A CERTIFICATE TO THIS EFFECT FROM THE CARRIER OR THEIR AGENT MUST ACCOMPANY THE ORIGINAL SHIPPING DOCUMENTS",
    );
    expect(fs[1]!.evidence[0]!.value).toBe(
      "THE BENEFICIARY IS REQUIRED TO SEND ONE SET OF NON-NEGOTIABLE SHIPPING DOCUMENTS DIRECT TO THE APPLICANT BY COURIER SERVICE AND THE RELEVANT COURIER RECEIPT MUST ACCOMPANY THE ORIGINAL SHIPPING DOCUMENTS",
    );
    expect(fs[0]!.params.snippet).toBe(fs[0]!.evidence[0]!.value);
  });
  it("004：随单发送证明、船代信息、发票与装箱单版式", () => {
    const lc = lcOf({
      documentsRequired:
        "+SHIPMENT ADVICE ... A COPY OF SUCH ADVICE, TOGETHER WITH COURIER OR EMAIL DISPATCH PROOF, MUST ACCOMPANY THE ORIGINAL SHIPPING DOCUMENTS.",
      additionalConditions:
        "04. NAME, ADDRESS, PHONE NUMBER OF THE SHIPPING AGENT, OF THE CARRIER/SHIPPING COMPANY, IN BANGLADESH\nMUST BE MENTIONED IN THE BILL OF LADING.\n" +
        "06. COMMERCIAL INVOICE MUST BE PRESENTED IN A CLEARLY DEFINED TABULAR FORMAT, SHOWING THE FOLLOWING DETAILS (COLUMN HEADINGS)\n" +
        "07. PACKING LIST MUST INDICATE ITEM WISE (PRODUCT DESCRIPTION, H.S. CODE, QUANTITY)",
    });
    // 第 06、07 条各是一条版式要求，逐条列出；第 06 条内多处命中（表格、列头）只报一次
    const fs = burdensomeClauses.evaluate({ lc });
    expect(codes(fs)).toEqual(["lc.burden.dispatchProof", "lc.burden.localAgentBl", "lc.burden.docFormat", "lc.burden.docFormat"]);
    expect(fs[2]!.evidence[0]!.value.startsWith("06.")).toBe(true);
    expect(fs[3]!.evidence[0]!.value.startsWith("07.")).toBe(true);
  });
  it("条款很长时以命中处为中心截取，关键那句话不会被截掉（样本 004 的装运通知）", () => {
    const lc = lcOf({
      documentsRequired:
        "+SHIPMENT ADVICE ALL SHIPMENTS UNDER THIS CREDIT MUST BE ADVISED BY COURIER OR EMAIL XXXXXXXXXXXXX WITHIN 05 (FIVE) DAYS OF SHIPMENT DIRECTLY TO XXXXXXXXXXXXX AND TO THE APPLICANT, REFERRING TO THEIR COVER NOTE NO. XXXXXXXXXXXXX DATED XXXXXXXXXXXXX. A COPY OF SUCH ADVICE ，TOGETHER WITH COURIER OR EMAIL DISPATCH PROOF，MUST ACCOMPANY THE ORIGINAL SHIPPING DOCUMENTS.\n+BILL OF EXCHANGE X",
      additionalConditions: "",
    });
    const v = burdensomeClauses.evaluate({ lc })[0]!.evidence[0]!.value;
    expect(v).toContain("TOGETHER WITH COURIER OR EMAIL DISPATCH PROOF");
    expect(v).toContain("MUST ACCOMPANY THE ORIGINAL SHIPPING DOCUMENTS");
    expect(v.startsWith("…")).toBe(true); // 前面被省略，不是从词中间开始
    expect(v.length).toBeLessThan(300);
  });
  it("不误伤普通条款与承运人签发的提单要求", () => {
    const lc = lcOf({
      documentsRequired: "+FULL SET OF CLEAN SHIPPED ON BOARD BILL OF LADING ISSUED BY THE CARRIER",
      additionalConditions: "+ALL DOCUMENTS MUST BE ISSUED IN ENGLISH LANGUAGE.\n+THE NAME AND ADDRESS OF THE APPLICANT MUST APPEAR ON THE INVOICE",
    });
    expect(burdensomeClauses.evaluate({ lc })).toEqual([]);
  });
});

describe("LCR-SPARE-PARTS", () => {
  it("写了备品固定数量、没有免费货物条款时提示", () => {
    expect(codes(spareParts.evaluate({ lc: lcOf() }))).toEqual(["lc.spareParts"]);
  });
  it("已有免费备品可接受的条款则不提示；没有备品也不提示", () => {
    expect(spareParts.evaluate({ lc: lcOf({ additionalConditions: "+ANY FREE OF CHARGE SPARE PARTS SHOWN IN DOCUMENTS ARE ACCEPTABLE" }) })).toEqual([]);
    expect(spareParts.evaluate({ lc: lcOf({ goodsDescription: "1. COMPUTER MONITOR QUANTITY: 10 UNIT" }) })).toEqual([]);
  });
});

describe("LCR-DATE-COHERENCE（暂保单 / 形式发票 / 开证日）", () => {
  it("003 初稿：暂保单 18.06 早于形式发票 23.06", () => {
    const fs = dateCoherence.evaluate({ lc: lcOf() });
    expect(codes(fs)).toEqual(["lc.dates.coverBeforeProforma"]);
    expect(fs[0]!.params).toMatchObject({ cover: "2026-06-18", proforma: "2026-06-23" });
    // 证据只取「标签……日期」，不带后面无关的文字
    expect(fs[0]!.evidence[0]!.value).toBe("COVER NOTE NUMBER AND DATE: SAIC/DIL/MC-XXXX/06/2026 DT.18.06.2026");
    expect(fs[0]!.evidence[1]!.value).toBe("PROFORMA INVOICE NUMBER AND DATE: CCTO6O331 23.06.2026");
  });
  it("正本的写法（暂保单在形式发票之后、开证日之前）不提示", () => {
    const lc = lcOf({
      issueDate: "2026-07-06",
      documentsRequired: "A) PROFORMA INVOICE NUMBER AND DATE: CCT060331\n23.06.2026\nG) INSURANCE COVER NOTE NUMBER AND DATE:\nSAIC/DIL/MC-0769/07/2026 DT.05.07.2026",
    });
    expect(dateCoherence.evaluate({ lc })).toEqual([]);
  });
  it("识别 002 / 001 / 004 的各种日期写法，且不把暂保单号里的 57/08/2026 当日期", () => {
    const pi = (s: string, issue = "2026-12-31") =>
      dateCoherence.evaluate({ lc: lcOf({ issueDate: issue, goodsDescription: s, documentsRequired: "", additionalConditions: "" }) });
    // 002：NO. 编号 DATE dd.mm.yyyy，形式发票晚于开证日
    expect(codes(pi("PROFORMA INVOICE NO.\nCCT08260921 DATE 12.10.2026", "2026-10-01"))).toEqual(["lc.dates.proformaAfterIssue"]);
    // 004：DTD. dd-Mon-yyyy
    // 日期写法能读出（2025-09-02）；相隔 152 天，所以只命中「过旧」这条提示，没有别的
    expect(codes(pi("PROFORMA INVOICE NO. CCT050902 DTD. 02-Sep-2025", "2026-02-01"))).toEqual(["lc.dates.proformaStale"]);
    // 001：暂保单号后紧跟 ,DATE.dd.mm.yyyy，晚于开证日
    const late = pi("INSURANCE COVER NOTE NUMBER AND DATE:\nSAIC/DIL/MC-1057/08/2026,DATE.27.08.2026", "2026-08-25");
    expect(codes(late)).toEqual(["lc.dates.coverAfterIssue"]);
    expect(late[0]!.params.cover).toBe("2026-08-27");
  });
});

describe("LCR-REF-TYPO（字母 O 与数字 0）", () => {
  it("样本 003 修改件3：CCTO6O331 → CCT060331", () => {
    const fs = letterOTypo.evaluate({ lc: lcOf() });
    expect(codes(fs)).toEqual(["lc.typo.letterO"]);
    expect(fs[0]!.params.suggested).toBe("CCT060331");
    expect(fs[0]!.evidence[0]!.field).toBe("46A");
  });
  it("004 的型号末位 O", () => {
    const fs = letterOTypo.evaluate({ lc: lcOf({ goodsDescription: "COMPUTER MONITOR MODEL X24IFR12O", documentsRequired: "", additionalConditions: "" }) });
    expect(fs[0]!.params.suggested).toBe("X24IFR120");
  });
  it("正常单词与纯数字编号不提示", () => {
    const lc = lcOf({
      goodsDescription: "MODEL X22IFR100 INCOTERMS 2020 CFR CHATTOGRAM",
      documentsRequired: "IRC 260326111215720 BIN 000341954-0201 H.S. CODE 8528.52.10 ORIGINAL COPIES",
      additionalConditions: "NO.1 OF FIELD 46A, 2(TWO) PERCENT, 14TH FLOOR, MC-0769/07/2026",
    });
    expect(letterOTypo.evaluate({ lc })).toEqual([]);
  });
});

describe("LCR-TYPO-WORDS（样本 004 初稿里没被批注的笔误）", () => {
  const goods = (g: string) => lcOf({ goodsDescription: g, documentsRequired: "", additionalConditions: "" });
  it("COMPUTR、21-5-INCH", () => {
    const fs = typoWords.evaluate({ lc: goods("+VALUE TOP COMPUTER MONITOR\n1.COMPUTR MONITOR 21-5-INCH\nX22IFR100") });
    expect(codes(fs)).toEqual(["lc.typo.hyphenDecimal", "lc.typo.word"]);
    expect(fs[0]!.params.suggested).toBe("21.5-INCH");
    expect(fs[0]!.evidence[0]!.field).toBe("45A");
    expect(fs[1]!.params).toEqual({ token: "COMPUTR", suggested: "COMPUTER" });
    expect(fs.every((f) => f.severity === "info")).toBe(true);
    expect(fs[1]!.evidence[0]!.value).toContain("COMPUTR MONITOR");
  });
  it("正常的词形变化、美式拼写和 21.5-INCH 不报", () => {
    const text =
      "INVOICES INVOICED SHIPMENTS DOCUMENTS CERTIFIED CERTIFYING BENEFICIARIES DISCREPANCIES AUTHORITIES ACCOMPANIED PRESENTED PRESENTING " +
      "TRANSSHIPMENT TRANSHIPMENT ORGANISATION ORGANIZATION 21.5-INCH COMPUTER MONITORS PACKAGES REQUIRED NEGOTIATING NEGOTIATION";
    expect(typoWords.evaluate({ lc: goods(text) })).toEqual([]);
    // 样本 003 正本的整段文字也不应有误报
    expect(typoWords.evaluate({ lc: lcOf() })).toEqual([]);
  });
  it("末位不同的变体（CERTIFIES 与 CERTIFIED）不当作笔误", () => {
    expect(typoWords.evaluate({ lc: goods("THE BENEFICIARY CERTIFIES THE GOODS") })).toEqual([]);
  });
});

describe("形式发票日期过旧（样本 004：02-Sep-2025 对开证日 2026-02-01）", () => {
  it("相差超过 120 天给出低优先级提示；正常间隔不提示", () => {
    const f = (pi: string, issue: string) =>
      dateCoherence.evaluate({ lc: lcOf({ issueDate: issue, goodsDescription: `PROFORMA INVOICE NO. CCT050902 DTD. ${pi}`, documentsRequired: "", additionalConditions: "" }) });
    const stale = f("02-Sep-2025", "2026-02-01");
    expect(codes(stale)).toEqual(["lc.dates.proformaStale"]);
    expect(stale[0]!.severity).toBe("info");
    expect(stale[0]!.params).toMatchObject({ proforma: "2025-09-02", issue: "2026-02-01", days: 152 });
    expect(f("18 AUG 2026", "2026-08-27")).toEqual([]); // 样本 001：9 天
    expect(f("12.10.2026", "2026-10-26")).toEqual([]); // 样本 002：14 天
  });
});

describe("LCR-PLACEHOLDER", () => {
  it("暂保单号 MC-XXXX 未填", () => {
    const fs = placeholders.evaluate({ lc: lcOf() });
    expect(codes(fs)).toEqual(["lc.placeholder"]);
    expect(fs[0]!.evidence[0]!.field).toBe("46A");
  });
  it("同一字段里的多处占位符全部列出（BIN、TIN、暂保单号），不只报第一处", () => {
    const lc = lcOf({
      documentsRequired:
        "B) APPLICANT'S BIN (BUSINESS IDENTIFICATION NUMBER): XXXXXXXXX C) APPLICANT'S TIN (TAX IDENTIFICATION NUMBER): XXXXX D) COUNTRY OF ORIGIN: CHINA G) INSURANCE COVER NOTE NUMBER AND DATE: SAIC/DIL/MC-XXXX/06/2026 DT.18.06.2026",
    });
    const fs = placeholders.evaluate({ lc });
    expect(fs).toHaveLength(1);
    const v = fs[0]!.evidence[0]!.value;
    expect(v).toContain("XXXXXXXXX");
    expect(v).toContain("TAX IDENTIFICATION NUMBER): XXXXX");
    expect(v).toContain("MC-XXXX");
    expect(v.startsWith("IDENTIFICATION") || v.startsWith("(BUSINESS") || v.startsWith("NUMBER")).toBe(true); // 不以半个单词开头
  });
  it("单价 XX.XX 带小数点算一处（样本 002 初稿）", () => {
    const lc = lcOf({ goodsDescription: "TOTAL QUANTITY:1648 UNIT,UNIT PRICE:XX.XX/UNIT\nTOTAL QUANTITY:600 UNIT,UNIT PRICE:XXX.XX/UNIT", documentsRequired: "", additionalConditions: "" });
    const v = placeholders.evaluate({ lc })[0]!.evidence[0]!.value;
    expect(v).toContain("PRICE:XX.XX");
    expect(v).toContain("PRICE:XXX.XX");
    expect(v.split(" … ")).toHaveLength(2); // 两处，不是四处
  });
  it("BIC 里的 XXX 与单词不算占位符", () => {
    const lc = lcOf({ goodsDescription: "DRAWEE SCBLBDDXXXX", documentsRequired: "SIZE XXL AND MC-0769/07/2026", additionalConditions: "" });
    expect(placeholders.evaluate({ lc })).toEqual([]);
  });
});

describe("规则登记", () => {
  it("每条新规则都有中英文名称，每个发现都有中英文文案", () => {
    for (const id of ["LCR-BURDENSOME-CLAUSES", "LCR-SPARE-PARTS", "LCR-DATE-COHERENCE", "LCR-REF-TYPO", "LCR-TYPO-WORDS", "LCR-PLACEHOLDER"]) {
      expect(allRules.some((r) => r.id === id)).toBe(true);
      expect(RULE_TITLES[id]?.zh).toBeTruthy();
      expect(RULE_TITLES[id]?.en).toBeTruthy();
    }
    const fs = [...allRules.filter((r) => r.stage === "lc")].flatMap((r) => (r.stage === "lc" ? r.evaluate({ lc: lcOf() }) : []));
    for (const f of fs) {
      expect(localizeFinding(f, "en").message).not.toContain("{");
      expect(localizeFinding(f, "zh").message).not.toContain("{");
    }
  });
});
