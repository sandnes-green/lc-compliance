import { describe, expect, it } from "vitest";
import { latestShipment, localizeFinding, makeFinding, parseMt700, Mt700Error, presentationPeriod } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const lc = parseMt700(SAMPLE_MT700);

describe("不符点本地化", () => {
  const [f] = latestShipment.evaluate({ lc, presentation: { presentationDate: "2024-08-25", transport: { shipmentDate: "2024-08-23" } } });

  it("同一条不符点可输出中文与英文，参数被代入", () => {
    expect(localizeFinding(f!, "zh").message).toBe("装运日 2024-08-23 晚于最迟装运日 2024-08-20，迟 3 天");
    const en = localizeFinding(f!, "en");
    expect(en.message).toBe("Shipment date 2024-08-23 is after the latest shipment date 2024-08-20, 3 day(s) late");
    expect(en.suggestion).toMatch(/amendment/);
  });

  it("默认 message 即中文文案", () => {
    expect(f!.message).toBe(localizeFinding(f!, "zh").message);
  });

  it("未知编码（如旧数据）回退到存档文案，不抛错", () => {
    const old = { ...f!, code: "removed.code", message: "旧文案", suggestion: "旧建议" };
    expect(localizeFinding(old, "en")).toEqual({ message: "旧文案", suggestion: "旧建议" });
  });

  it("所有规则产生的编码在中英文目录中都存在", () => {
    const base = { ruleId: "x", clause: "x", severity: "info" as const, evidence: [] };
    for (const code of ["presentation.expired", "presentation.stale", "presentation.noShipmentDate", "invoice.currencyMismatch", "invoice.amountExceeded", "shipment.late"]) {
      const g = makeFinding({ ...base, code, params: {} });
      expect(localizeFinding(g, "en").message).not.toBe(g.message);
      expect(localizeFinding(g, "en").message).toBeTruthy();
    }
  });

  it("缺数据的疑点也能英文展示", () => {
    const [d] = presentationPeriod.evaluate({ lc, presentation: { presentationDate: "2024-08-25" } });
    expect(localizeFinding(d!, "en").message).toMatch(/no shipment date/);
  });
});

describe("错误编码", () => {
  it("解析错误带稳定编码", () => {
    expect(() => parseMt700(":20:X")).toThrowError(expect.objectContaining({ code: "mt700.field32B" }));
    expect(() => parseMt700(":32B:USD1,00")).toThrowError(expect.objectContaining({ code: "mt700.field20" }));
    expect(() => parseMt700(":20:X")).toThrow(Mt700Error);
  });
});

describe("规则名称", () => {
  it("每条内置规则都登记了中英文名称", async () => {
    const { allRules, RULE_TITLES, ruleTitle } = await import("../src");
    for (const r of allRules) {
      expect(RULE_TITLES[r.id], r.id).toBeDefined();
      expect(ruleTitle(r.id, "zh")).not.toBe(r.id);
      expect(ruleTitle(r.id, "en")).not.toBe(r.id);
    }
    expect(Object.keys(RULE_TITLES).sort()).toEqual(allRules.map((r) => r.id).sort());
    expect(ruleTitle("UNKNOWN", "en")).toBe("UNKNOWN");
  });
});
