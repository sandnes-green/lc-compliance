import { describe, expect, it } from "vitest";
import { buildCountryRiskRule, localizeFinding, parseMt700, runRules } from "../src";
import type { CountryRule } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const rule = (p: Partial<CountryRule> = {}): CountryRule => ({
  id: "r1", countryCode: "BD", level: "notice", requirements: ["carrierBl", "noTranshipment"], note: "测试备注", enabled: true, reviewed: false, ...p,
});
const lcOf = (bic?: string) => parseMt700(bic ? SAMPLE_MT700.replace(":27:1/1", `:27:1/1\n:52A:${bic}`) : SAMPLE_MT700);
const run = (rules: CountryRule[], lc = lcOf("TESTBDDHXXX")) => runRules([buildCountryRiskRule(rules)], { lc });

describe("LCR-COUNTRY-RISK", () => {
  it("命中国家时列出要求、备注与待审核状态（中英文）", () => {
    const { findings } = run([rule()]);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.code).toBe("country.hit");
    expect(f.severity).toBe("info");
    expect(f.stage).toBe("lc");
    const zh = localizeFinding(f, "zh").message;
    expect(zh).toContain("必须船东单");
    expect(zh).toContain("禁止转运");
    expect(zh).toContain("测试备注");
    expect(zh).toContain("待审核");
    expect(localizeFinding(f, "en").message).toContain("Carrier-issued");
  });
  it("高风险等级对应 risk；已审核不再带待审核字样", () => {
    const f = run([rule({ level: "high", reviewed: true })]).findings[0]!;
    expect(f.severity).toBe("risk");
    expect(localizeFinding(f, "zh").message).not.toContain("待审核");
  });
  it("国家不在表里：没有发现", () => {
    expect(run([rule()], lcOf("TESTUS33XXX")).findings).toEqual([]);
  });
  it("停用的规则不参与", () => {
    expect(run([rule({ enabled: false })]).findings).toEqual([]);
  });
  it("读不出开证行国家：提示未检查，而不是当作通过", () => {
    const f = run([rule()], lcOf()).findings[0]!;
    expect(f.code).toBe("country.unknown");
    expect(f.severity).toBe("info");
  });
  it("表里没有任何启用的规则：不出任何提示", () => {
    expect(run([], lcOf()).findings).toEqual([]);
  });
});
