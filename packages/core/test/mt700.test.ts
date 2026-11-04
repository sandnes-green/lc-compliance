import { describe, expect, it } from "vitest";
import { Mt700Error, parseMt700, parseSwiftAmount, parseSwiftDate, splitSwiftFields } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

describe("parseMt700", () => {
  const lc = parseMt700(SAMPLE_MT700);

  it("解析核心字段", () => {
    expect(lc.reference).toBe("LC2024-0001");
    expect(lc.currency).toBe("USD");
    expect(lc.amount).toBe(100000);
    expect(lc.issueDate).toBe("2024-06-01");
    expect(lc.expiryDate).toBe("2024-09-30");
    expect(lc.expiryPlace).toBe("NEW YORK");
    expect(lc.tolerance).toEqual({ plus: 5, minus: 5 });
    expect(lc.latestShipmentDate).toBe("2024-08-20");
    expect(lc.presentationDays).toBe(21);
  });

  it("多行字段保留换行，且不吞掉块尾标记", () => {
    expect(lc.goodsDescription).toBe("1000 SETS OF WIDGETS MODEL X\nCIF NEW YORK");
    expect(lc.documentsRequired).toContain("FULL SET OF CLEAN ON BOARD");
    expect(lc.raw["48"]).toBe("21 DAYS AFTER SHIPMENT BUT WITHIN VALIDITY");
  });

  it("缺少 32B 或 20 时抛出明确错误", () => {
    expect(() => parseMt700(":20:X\n:31C:240601")).toThrow(Mt700Error);
    expect(() => parseMt700(":32B:USD100,00")).toThrow(/20/);
  });
});

describe("helpers", () => {
  it("金额使用逗号小数点", () => {
    expect(parseSwiftAmount("1234,56")).toBe(1234.56);
    expect(parseSwiftAmount("500,")).toBe(500);
    expect(parseSwiftAmount("12.5")).toBeUndefined();
  });

  it("非法日期返回 undefined", () => {
    expect(parseSwiftDate("240230")).toBeUndefined();
    expect(parseSwiftDate("240229")).toBe("2024-02-29");
  });

  it("重复标签拼接", () => {
    expect(splitSwiftFields(":79:A\n:79:B")["79"]).toBe("A\nB");
  });
});

describe("formatLocalTime", () => {
  it("按本机时区显示，不受时区影响地往返", async () => {
    const { formatLocalTime } = await import("../src");
    const local = new Date(2024, 0, 2, 3, 4, 5); // 本地时间 2024-01-02 03:04:05
    expect(formatLocalTime(local.toISOString())).toBe("2024-01-02 03:04:05");
    expect(formatLocalTime("not a date")).toBe("not a date");
  });
});
