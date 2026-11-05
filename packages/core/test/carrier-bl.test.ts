import { describe, expect, it } from "vitest";
import { buildCarrierBlRule, classifyIssuer, detectCarrierBlClause, localizeFinding, parseMt700, runRules } from "../src";
import type { CountryRule, Presentation } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const lcWith = (extra47A = "", bic?: string) =>
  parseMt700(
    SAMPLE_MT700.replace(":47A:+ALL DOCUMENTS IN ENGLISH", `:47A:+ALL DOCUMENTS IN ENGLISH${extra47A}`).replace(":27:1/1", bic ? `:27:1/1\n:52A:${bic}` : ":27:1/1"),
  );
const bdRule: CountryRule = { id: "r", countryCode: "BD", level: "notice", requirements: ["carrierBl"], note: "", enabled: true, reviewed: true };
const pres = (transport?: Presentation["transport"]): Presentation => ({ presentationDate: "2024-08-25", transport });

describe("detectCarrierBlClause", () => {
  it.each([
    "+B/L MUST BE ISSUED BY THE CARRIER OR SHIPOWNER",
    "+BILL OF LADING ISSUED BY SHIPOWNER ONLY",
    "+FORWARDER'S B/L NOT ACCEPTABLE",
    "+FREIGHT FORWARDER BILL OF LADING IS NOT ACCEPTED",
    "+HOUSE B/L NOT ALLOWED",
    "+SHIPOWNER'S BILL OF LADING REQUIRED",
    "+ISSUED BY THE SHIPPING LINE",
    "+ISSUED BY THE ACTUAL CARRIER",
    "+ISSUED BY OCEAN CARRIER",
    "+CARRIER’S B/L",
    "+FORWARDERS B/L UNACCEPTABLE",
    "+FORWARDER'S B/L IS NOT PERMITTED",
    "+NO B/L ISSUED BY FORWARDER IS ACCEPTABLE",
  ])("识别：%s", (clause) => {
    const hit = detectCarrierBlClause(lcWith(`\n${clause}`));
    expect(hit?.field).toBe("47A");
    expect(hit?.snippet.length).toBeGreaterThan(0);
  });
  it.each([
    "+HOUSE B/L ACCEPTABLE, GOODS MUST NOT BE TRANSHIPPED",
    "+B/L SHOWING NAME OF CARRIER B/L NUMBER",
    "+B/L SHOWING NAME OF CARRIER BL NUMBER",
    "+NOT ACCEPTED FROM WAREHOUSE",
    "+BILL OF LADING MUST NOT BE ISSUED BY THE CARRIER",
    "+ALL DOCUMENTS IN ENGLISH",
    "+FREIGHT PREPAID",
  ])("不误报：%s", (clause) => {
    expect(detectCarrierBlClause(lcWith(`\n${clause}`))).toBeNull();
  });
  it("没有附加条款时不误报", () => {
    expect(detectCarrierBlClause(lcWith())).toBeNull();
  });
});

describe("classifyIssuer（单段文字）", () => {
  it.each([
    ["Evergreen Marine as carrier", "carrier"],
    ["signed by the master", "carrier"],
    ["Master", "carrier"],
    ["as master", "carrier"],
    ["as carrier", "carrier"],
    ["Shipowner", "carrier"],
    ["XYZ Logistics, freight forwarder", "forwarder"],
    ["Forwarding", "forwarder"],
    ["ABC NVOCC", "forwarder"],
    ["XYZ Freight Forwarding Co as carrier", "forwarder"],
    ["NVOCC acting as carrier", "forwarder"],
    ["Agent for the carrier", "agent"],
    ["not the carrier", "unknown"],
    ["Carrier", "unknown"],
    ["cargo owner", "unknown"],
    ["", "unknown"],
    ["Some Co", "unknown"],
  ])("%s → %s", (text, kind) => expect(classifyIssuer(text)).toBe(kind));
});

describe("UCP600-20-CARRIER-BL", () => {
  const run = (lc: ReturnType<typeof lcWith>, p: Presentation | null, rules: CountryRule[] = [bdRule]) =>
    runRules([buildCarrierBlRule(rules)], { lc, presentation: p });

  it("没有任何来源要求：不出发现，也不影响其他规则", () => {
    expect(run(lcWith(), pres({ signingCapacity: "freight forwarder" })).findings).toEqual([]);
  });
  it("来源是国别规则：货代签发 → 疑点，并注明来源", () => {
    const { findings } = run(lcWith("", "TESTBDDHXXX"), pres({ issuerName: "ABC Logistics", signingCapacity: "as freight forwarder" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("carrierBl.forwarder");
    expect(findings[0]!.severity).toBe("doubt");
    expect(findings[0]!.stage).toBe("docs");
    expect(localizeFinding(findings[0]!, "zh").message).toContain("国别规则");
  });
  it("只有签发人名称而没有签发身份：不能通过，需确认", () => {
    const lc = lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER");
    expect(run(lc, pres({ issuerName: "Carrier" })).findings[0]!.code).toBe("carrierBl.confirm");
    expect(run(lc, pres({ issuerName: "Carrier", signingCapacity: " " })).findings[0]!.code).toBe("carrierBl.confirm");
  });
  it("签发人名称含货代字样、身份写 as carrier：仍判货代", () => {
    const lc = lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER");
    const f = run(lc, pres({ issuerName: "XYZ Freight Forwarding Co", signingCapacity: "as carrier" })).findings;
    expect(f[0]!.code).toBe("carrierBl.forwarder");
  });
  it("证据分成签发人与签发身份两行，空值不出行", () => {
    const lc = lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER");
    const ev = (t: Presentation["transport"]) => run(lc, pres(t)).findings[0]!.evidence.filter((e) => e.document === "transport");
    expect(ev({ issuerName: "ABC", signingCapacity: "agent" })).toEqual([
      { document: "transport", field: "issuerName", value: "ABC" },
      { document: "transport", field: "signingCapacity", value: "agent" },
    ]);
    expect(ev({ issuerName: "ABC" })).toEqual([{ document: "transport", field: "issuerName", value: "ABC" }]);
    expect(ev({ shipmentDate: "2024-08-01" })).toEqual([]);
    const all = run(lc, pres({ issuerName: "ABC", signingCapacity: " " })).findings[0]!.evidence;
    expect(all.every((e) => e.value !== "")).toBe(true);
  });
  it("无来源且开证国未知、国别规则要求船东单：记为未检查而非通过", () => {
    const r = run(lcWith(), pres({ signingCapacity: "as carrier" }));
    expect(r.findings).toEqual([]);
    expect(r.coverage.skipped).toContain("UCP600-20-CARRIER-BL");
    expect(r.coverage.checked).not.toContain("UCP600-20-CARRIER-BL");
  });
  it("无来源且没有国别规则：已检查，无发现", () => {
    const r = run(lcWith(), pres(), []);
    expect(r.findings).toEqual([]);
    expect(r.coverage.checked).toContain("UCP600-20-CARRIER-BL");
  });
  it("开证国已知但不在规则表：已检查，无发现", () => {
    const r = run(lcWith("", "TESTSGSG"), pres());
    expect(r.findings).toEqual([]);
    expect(r.coverage.checked).toContain("UCP600-20-CARRIER-BL");
  });
  it("来源是信用证条款：承运人签发 → 通过", () => {
    const lc = lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER");
    expect(run(lc, pres({ signingCapacity: "as carrier" })).findings).toEqual([]);
    expect(localizeFinding(run(lc, pres({ signingCapacity: "agent for the carrier" })).findings[0]!, "zh").message).toContain("信用证条款");
  });
  it("代理或无法判断：需人工确认", () => {
    const lc = lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER");
    expect(run(lc, pres({ signingCapacity: "agent for the carrier" })).findings[0]!.code).toBe("carrierBl.confirm");
    expect(run(lc, pres({ shipmentDate: "2024-08-01" })).findings[0]!.code).toBe("carrierBl.confirm");
  });
  it("有要求但没有运输单据数据：记为未检查", () => {
    const r = run(lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER"), pres());
    expect(r.findings).toEqual([]);
    expect(r.coverage.skipped).toContain("UCP600-20-CARRIER-BL");
  });
  it("国别规则停用或未勾选 carrierBl 时不触发", () => {
    const lc = lcWith("", "TESTBDDHXXX");
    expect(run(lc, pres({ signingCapacity: "forwarder" }), [{ ...bdRule, enabled: false }]).findings).toEqual([]);
    expect(run(lc, pres({ signingCapacity: "forwarder" }), [{ ...bdRule, requirements: ["noTranshipment"] }]).findings).toEqual([]);
  });
});
