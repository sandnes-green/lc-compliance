import { describe, expect, it } from "vitest";
import { parseCountryRuleDraft, regionName, STARTER_COUNTRY_RULES } from "../src";

const good = { countryCode: "bd", level: "notice", requirements: ["carrierBl"], note: "x", enabled: true, reviewed: false };

describe("国别规则校验", () => {
  it("接受合法内容，国家代码规范成大写", () => {
    const r = parseCountryRuleDraft(good);
    expect(r.ok && r.draft.countryCode).toBe("BD");
  });
  it.each([
    [{ ...good, countryCode: "BGD" }, "countryCode"],
    [{ ...good, countryCode: "" }, "countryCode"],
    [{ ...good, level: "x" }, "level"],
    [{ ...good, requirements: ["nope"] }, "requirements"],
    [{ ...good, requirements: "carrierBl" }, "requirements"],
    [{ ...good, note: 5 }, "note"],
    [{ ...good, enabled: "yes" }, "enabled"],
    [null, "root"],
  ])("拒绝非法内容 %#", (raw, field) => {
    const r = parseCountryRuleDraft(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(field);
  });
  it("去重要求事项，备注限长", () => {
    const r = parseCountryRuleDraft({ ...good, requirements: ["carrierBl", "carrierBl"] });
    expect(r.ok && r.draft.requirements).toEqual(["carrierBl"]);
    expect(parseCountryRuleDraft({ ...good, note: "a".repeat(2001) }).ok).toBe(false);
  });
});

describe("起步清单", () => {
  it("只有孟加拉与土耳其，只含船东单，并且都是未审核", () => {
    expect(STARTER_COUNTRY_RULES.map((r) => r.countryCode)).toEqual(["BD", "TR"]);
    for (const r of STARTER_COUNTRY_RULES) {
      expect(r.requirements).toEqual(["carrierBl"]);
      expect(r.reviewed).toBe(false);
      expect(parseCountryRuleDraft(r).ok).toBe(true);
    }
  });
});

describe("regionName", () => {
  it("返回本地化国家名，未知代码回退为代码本身", () => {
    expect(regionName("BD", "en")).toMatch(/Bangladesh/);
    expect(regionName("TR", "zh")).toMatch(/土耳其|土耳其共和国|Türkiye/);
    expect(regionName("ZZ", "en")).toBeTruthy();
  });
});
