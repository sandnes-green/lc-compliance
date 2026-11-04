import { describe, expect, it } from "vitest";
import {
  allRules,
  compareGoods,
  compareNames,
  expiryPlace,
  expiryVsShipment,
  goodsDescription,
  insuranceCover,
  invoiceParties,
  isGenericPort,
  localizeFinding,
  parseMt700,
  portMatches,
  runRules,
  softClauses,
  transportPorts,
} from "../src";
import type { LetterOfCredit, Presentation } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const base = parseMt700(SAMPLE_MT700);
const lcWith = (patch: Partial<LetterOfCredit>): LetterOfCredit => ({ ...base, ...patch });
const pres = (p: Partial<Presentation> = {}): Presentation => ({ presentationDate: "2024-08-25", ...p });

describe("MT700 新增字段", () => {
  const lc = parseMt700(`${SAMPLE_MT700.replace(":32B:", ":44E:SHANGHAI, CHINA\n:44F:NEW YORK\n:43P:ALLOWED\n:43T:NOT ALLOWED\n:32B:")}`);
  it("名称取首行并跳过 /账号 行", () => {
    expect(lc.applicantName).toBe("ACME IMPORTS INC");
    expect(lc.beneficiaryName).toBe("SANDNES TRADING CO LTD");
    expect(parseMt700(":20:X\n:32B:USD1,00\n:59:/123456789\nFOO BAR LTD\nSOME ROAD").beneficiaryName).toBe("FOO BAR LTD");
  });
  it("解析类型、港口、分批与转运", () => {
    expect(lc.form).toBe("IRREVOCABLE");
    expect(lc.portOfLoading).toBe("SHANGHAI, CHINA");
    expect(lc.portOfDischarge).toBe("NEW YORK");
    expect(lc.partialShipments).toBe("ALLOWED");
    expect(lc.transhipment).toBe("NOT ALLOWED");
  });
});

describe("文本比较", () => {
  it("名称：忽略大小写、标点与公司后缀", () => {
    expect(compareNames("Sandnes Trading Co., Ltd.", "SANDNES TRADING CO LTD")).toBe("same");
  });
  it("名称：个别词差一个字符 / 缩写 → close，完全不同 → different", () => {
    expect(compareNames("SANDNESS TRADING CO LTD", "SANDNES TRADING CO LTD")).toBe("close");
    expect(compareNames("ACME IMPORTS INTERNATIONAL TRADING INC", "ACME IMPORTS INTL TRADING INC")).toBe("close");
    expect(compareNames("ACME IMPORTS", "GLOBAL TRADERS")).toBe("different");
    expect(compareNames("ACME IMPORTS", "ACME EXPORTS")).toBe("different");
    expect(compareNames("", "ACME")).toBe("different");
  });
  it("货描：虚词、单复数、千分位不影响；缺词会被列出", () => {
    const lcText = "1000 SETS OF WIDGETS MODEL X\nCIF NEW YORK";
    expect(compareGoods(lcText, "1,000 SET WIDGETS, MODEL X, CIF NEW YORK, packed in cartons").missing).toEqual([]);
    const r = compareGoods(lcText, "1000 SETS OF WIDGETS MODEL Y CIF NEW YORK");
    expect(r.missing).toEqual(["X"]);
    expect(r.coverage).toBeLessThan(1);
  });
  it("港口：以逗号前主名称为准；泛指港口识别", () => {
    expect(portMatches("SHANGHAI, CHINA", "SHANGHAI")).toBe(true);
    expect(portMatches("SHANGHAI", "NINGBO")).toBe(false);
    expect(isGenericPort("ANY PORT IN CHINA")).toBe(true);
    expect(isGenericPort("SHANGHAI")).toBe(false);
  });
});

describe("发票买卖方 18(a)", () => {
  const ev = (seller?: string, buyer?: string) =>
    invoiceParties.evaluate({ lc: base, presentation: pres({ invoice: { sellerName: seller, buyerName: buyer } }) });
  it("一致通过", () => {
    expect(ev("SANDNES TRADING CO., LTD.", "ACME IMPORTS INC")).toEqual([]);
  });
  it("卖方不是受益人 → 不符点", () => {
    const [f] = ev("OTHER EXPORT LTD", undefined);
    expect(f!.severity).toBe("discrepancy");
    expect(f!.code).toBe("invoice.sellerMismatch");
  });
  it("抬头与申请人相近 → 疑点", () => {
    const [f] = ev(undefined, "ACME IMPORT INC");
    expect(f!.severity).toBe("doubt");
    expect(f!.code).toBe("invoice.buyerClose");
  });
  it("没有名称数据时规则不适用", () => {
    expect(invoiceParties.applicable!({ lc: base, presentation: pres({ invoice: { amount: 1 } }) })).toBe(false);
  });
});

describe("货物描述 18(c)", () => {
  const ev = (desc: string) => goodsDescription.evaluate({ lc: base, presentation: pres({ invoice: { goodsDescription: desc } }) });
  it("一致且有额外说明 → 通过", () => {
    expect(ev("1000 SETS OF WIDGETS MODEL X CIF NEW YORK, GROSS WEIGHT 500KG")).toEqual([]);
  });
  it("型号不同（缺含数字/型号的词）→ 不符点，并指出缺失词", () => {
    const [f] = ev("1000 SETS OF WIDGETS MODEL Y CIF NEW YORK");
    expect(f!.severity).toBe("discrepancy");
    expect(f!.params.missing).toBe("X");
  });
  it("数量不同 → 不符点", () => {
    expect(ev("900 SETS OF WIDGETS MODEL X CIF NEW YORK")[0]!.severity).toBe("discrepancy");
  });
  it("缺少少量普通词 → 疑点", () => {
    const lc = lcWith({ goodsDescription: "STEEL WIDGETS BLUE COLOUR HIGH GRADE SHINY FINISH PACKED CARTON EXPORT QUALITY" });
    const f = goodsDescription.evaluate({ lc, presentation: pres({ invoice: { goodsDescription: "STEEL WIDGETS BLUE COLOUR HIGH GRADE SHINY FINISH PACKED CARTON" } }) });
    expect(f[0]!.severity).toBe("doubt");
  });
});

describe("保险 28", () => {
  const inv = { amount: 100000 };
  const ev = (insurance: Presentation["insurance"], extra: Partial<Presentation> = {}, lc = base) =>
    insuranceCover.evaluate({ lc, presentation: pres({ invoice: inv, insurance, ...extra }) });

  it("恰好 110% 通过（边界），少一分钱不符", () => {
    expect(ev({ currency: "USD", amount: 110000 })).toEqual([]);
    const [f] = ev({ currency: "USD", amount: 109999.99 });
    expect(f!.code).toBe("insurance.amountShort");
    expect(f!.params.required).toBe(110000);
  });
  it("信用证另有百分比要求（120 PCT）时按其执行", () => {
    const lc = lcWith({ documentsRequired: "+INSURANCE POLICY COVERING ALL RISKS FOR 120 PCT OF INVOICE VALUE" });
    expect(ev({ amount: 110000 }, {}, lc)[0]!.params.percent).toBe(120);
    expect(ev({ amount: 120000 }, {}, lc)).toEqual([]);
  });
  it("贸易术语不是 CIF/CIP 时降为疑点", () => {
    const lc = lcWith({ goodsDescription: "1000 SETS OF WIDGETS FOB SHANGHAI" });
    const [f] = ev({ amount: 100000 }, {}, lc);
    expect(f!.severity).toBe("doubt");
    expect(f!.code).toBe("insurance.amountShortUnknownTerm");
  });
  it("币种须与信用证一致", () => {
    expect(ev({ currency: "EUR", amount: 110000 })[0]!.code).toBe("insurance.currencyMismatch");
  });
  it("保险日期晚于装运日 → 不符；同日通过", () => {
    const t = { transport: { shipmentDate: "2024-08-10" } };
    expect(ev({ amount: 110000, date: "2024-08-11" }, t)[0]!.code).toBe("insurance.dateLate");
    expect(ev({ amount: 110000, date: "2024-08-10" }, t)).toEqual([]);
  });
  it("缺发票金额时提示疑点而不是静默通过", () => {
    const f = insuranceCover.evaluate({ lc: base, presentation: pres({ insurance: { amount: 5 } }) });
    expect(f[0]!.code).toBe("insurance.needInvoiceAmount");
  });
});

describe("装卸港 20(a)(iii)", () => {
  const lc = lcWith({ portOfLoading: "SHANGHAI, CHINA", portOfDischarge: "NEW YORK" });
  const ev = (t: NonNullable<Presentation["transport"]>, l = lc) => transportPorts.evaluate({ lc: l, presentation: pres({ transport: t }) });
  it("一致通过（主名称匹配）", () => {
    expect(ev({ portOfLoading: "Shanghai", portOfDischarge: "NEW YORK, USA" })).toEqual([]);
  });
  it("装运港不同 → 不符点", () => {
    const [f] = ev({ portOfLoading: "NINGBO" });
    expect(f!.code).toBe("transport.portLoadingMismatch");
    expect(f!.severity).toBe("discrepancy");
  });
  it("卸货港不同 → 不符点", () => {
    expect(ev({ portOfDischarge: "LOS ANGELES" })[0]!.code).toBe("transport.portDischargeMismatch");
  });
  it("信用证为泛指港口 → 疑点", () => {
    const [f] = ev({ portOfLoading: "NINGBO" }, lcWith({ portOfLoading: "ANY PORT IN CHINA" }));
    expect(f!.severity).toBe("doubt");
  });
});

describe("审证", () => {
  it("有效期早于最迟装运日 → 风险", () => {
    const [f] = expiryVsShipment.evaluate({ lc: lcWith({ expiryDate: "2024-08-10", latestShipmentDate: "2024-08-20" }) });
    expect(f!.code).toBe("lc.expiryBeforeShipment");
    expect(f!.severity).toBe("risk");
  });
  it("装运后到有效期不足交单期 → 风险；恰好等于交单期通过（边界）", () => {
    const short = expiryVsShipment.evaluate({ lc: lcWith({ expiryDate: "2024-09-05", latestShipmentDate: "2024-08-20" }) });
    expect(short[0]!.code).toBe("lc.shortWindow");
    expect(short[0]!.params.window).toBe(16);
    expect(expiryVsShipment.evaluate({ lc: lcWith({ expiryDate: "2024-09-10", latestShipmentDate: "2024-08-20" }) })).toEqual([]);
  });
  it("示例信用证（44C 8/20，31D 9/30）无此风险", () => {
    expect(expiryVsShipment.evaluate({ lc: base })).toEqual([]);
  });
  it("到期地点作为提示", () => {
    expect(expiryPlace.evaluate({ lc: base })[0]!.severity).toBe("info");
    expect(expiryPlace.evaluate({ lc: lcWith({ expiryPlace: undefined }) })).toEqual([]);
  });

  const soft = (text: string, field: "documentsRequired" | "additionalConditions" = "additionalConditions") =>
    softClauses.evaluate({ lc: lcWith({ documentsRequired: undefined, additionalConditions: undefined, [field]: text }) });

  it("识别典型软条款", () => {
    expect(soft("+INSPECTION CERTIFICATE ISSUED AND SIGNED BY THE APPLICANT")[0]!.code).toBe("lc.soft.applicantDoc");
    expect(soft("+PAYMENT SUBJECT TO APPLICANT'S APPROVAL OF THE DOCUMENTS")[0]!.code).toBe("lc.soft.applicantApproval");
    expect(soft("+THIS CREDIT WILL BE EFFECTIVE ONLY AFTER RECEIPT OF IMPORT LICENSE")[0]!.code).toBe("lc.soft.conditionalEffect");
    expect(soft("+NAME OF VESSEL TO BE ADVISED BY THE BUYER")[0]!.code).toBe("lc.soft.laterAdvice");
    expect(soft("+FULL SET OF B/L ... INSPECTION CERTIFICATE SIGNED BY BUYER", "documentsRequired").length).toBeGreaterThan(0);
  });
  it("普通条款不误报", () => {
    expect(soft("+ALL DOCUMENTS IN ENGLISH\n+ALL DOCUMENTS MUST SHOW L/C NUMBER")).toEqual([]);
    expect(soft("+COMMERCIAL INVOICE SIGNED BY BENEFICIARY")).toEqual([]);
    expect(softClauses.evaluate({ lc: base })).toEqual([]);
  });
  it("同一句话被多条模式命中（范围重叠）只报一次；不同位置的同类条款各报一次", () => {
    expect(soft("+INSPECTION CERTIFICATE SIGNED BY THE APPLICANT")).toHaveLength(1);
    const two = soft("+PACKING LIST ISSUED BY THE APPLICANT\n+QUALITY CERTIFICATE COUNTERSIGNED BY THE BUYER");
    expect(two).toHaveLength(2);
    expect(two.map((f) => f.code)).toEqual(["lc.soft.applicantDoc", "lc.soft.applicantDoc"]);
  });
  it("同一位置被多条模式命中只报一次，且证据带原文片段", () => {
    const f = soft("+CERTIFICATE ISSUED BY THE APPLICANT");
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence[0]!.value).toContain("ISSUED BY THE APPLICANT");
  });
});

describe("引擎：覆盖情况与分阶段执行", () => {
  it("没有交单数据时只跑审证规则，审单规则记为未检查", () => {
    const r = runRules(allRules, { lc: base });
    expect(r.coverage.checked.every((id) => id.startsWith("LCR-"))).toBe(true);
    expect(r.coverage.skipped).toContain("UCP600-14C-PRESENTATION");
    expect(r.errors).toEqual([]);
  });
  it("数据不足的审单规则记为未检查而不是通过", () => {
    const r = runRules(allRules, { lc: base, presentation: pres({ invoice: { currency: "USD", amount: 1000 } }) });
    expect(r.coverage.checked).toContain("UCP600-18-INVOICE-AMOUNT");
    expect(r.coverage.skipped).toEqual(expect.arrayContaining(["UCP600-28-INSURANCE", "UCP600-20A-PORTS", "UCP600-18C-GOODS", "UCP600-20-LATEST-SHIPMENT"]));
  });
  it("按严重程度排序：不符点 → 风险 → 疑点 → 提示", () => {
    const lc = lcWith({ expiryDate: "2024-08-10", latestShipmentDate: "2024-08-20", additionalConditions: "+CERTIFICATE ISSUED BY THE APPLICANT" });
    const r = runRules(allRules, { lc, presentation: pres({ invoice: { currency: "EUR" }, transport: {} }) });
    const sev = r.findings.map((f) => f.severity);
    expect(sev).toEqual([...sev].sort((a, b) => ["discrepancy", "risk", "doubt", "info"].indexOf(a) - ["discrepancy", "risk", "doubt", "info"].indexOf(b)));
    expect(sev).toContain("risk");
    expect(sev).toContain("discrepancy");
  });
  it("每条规则产生的编码都有英文文案", () => {
    const lc = lcWith({ expiryDate: "2024-08-10", latestShipmentDate: "2024-08-20", additionalConditions: "+CERTIFICATE ISSUED BY THE APPLICANT" });
    const r = runRules(allRules, {
      lc,
      presentation: pres({
        invoice: { currency: "EUR", amount: 999999, sellerName: "X LTD", buyerName: "Y LTD", goodsDescription: "NOTHING" },
        transport: { shipmentDate: "2024-09-30", portOfLoading: "A", portOfDischarge: "B" },
        insurance: { currency: "EUR", amount: 1, date: "2024-10-01" },
      }),
    });
    expect(r.findings.length).toBeGreaterThan(8);
    for (const f of r.findings) {
      const en = localizeFinding(f, "en").message;
      expect(en, f.code).not.toBe(f.message);
      expect(en, f.code).not.toMatch(/\{\w+\}/);
    }
  });
});
