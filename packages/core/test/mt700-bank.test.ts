import { describe, expect, it } from "vitest";
import { parseBank, parseMt700 } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

describe("52A 开证行", () => {
  it("取 BIC 与第 5、6 位国家代码", () => {
    expect(parseBank("TESTBDDHXXX")).toEqual({ bic: "TESTBDDHXXX", country: "BD" });
    expect(parseBank("TESTTRIS")).toEqual({ bic: "TESTTRIS", country: "TR" });
  });
  it("跳过首行 /账号 或 /D/ 标识", () => {
    expect(parseBank("/D/12345\nTESTBDDHXXX")).toEqual({ bic: "TESTBDDHXXX", country: "BD" });
  });
  it("小写 BIC 转大写后识别", () => {
    expect(parseBank("testbddh")).toEqual({ bic: "TESTBDDH", country: "BD" });
    expect(parseBank("/D/1\ntestbddhxxx")).toEqual({ bic: "TESTBDDHXXX", country: "BD" });
  });
  it("52D 式自由文本（名称加地址，无 BIC）返回空", () => {
    expect(parseBank("SOME BANK LTD\n12 MAIN STREET\nDHAKA")).toEqual({});
    expect(parseBank("some bank ltd\ntestbddh branch")).toEqual({});
  });
  it("无法识别时返回空，不猜", () => {
    expect(parseBank(undefined)).toEqual({});
    expect(parseBank("SOME BANK LTD\nDHAKA")).toEqual({});
    expect(parseBank("test1")).toEqual({});
  });
  it("parseMt700 写入 issuingBankBic / issuingCountry；没有 52A 时为空", () => {
    const lc = parseMt700(SAMPLE_MT700.replace(":27:1/1", ":27:1/1\n:52A:TESTBDDHXXX"));
    expect(lc.issuingBankBic).toBe("TESTBDDHXXX");
    expect(lc.issuingCountry).toBe("BD");
    const none = parseMt700(SAMPLE_MT700);
    expect(none.issuingBankBic).toBeUndefined();
    expect(none.issuingCountry).toBeUndefined();
  });
});
