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

describe("开证行国家：52A 缺失时的补充来源", () => {
  const withHead = (head: string, extra = "") => parseMt700(`${head}\n${SAMPLE_MT700.replace(/^\{1:[^\n]*\{4:/, "{4:").replace(":27:1/1", `:27:1/1${extra}`)}`);
  it("报文头 {2:O700…} 的发送方 BIC", () => {
    const lc = withHead("{1:F01TESTCNSHAXXX0000000000}{2:O7001200261101TESTBDDHAXXX00000000002611011200N}");
    expect(lc.issuingCountry).toBe("BD");
    expect(lc.issuingCountrySource).toBe("header");
  });
  it("打印件上的 Sender: 行", () => {
    const lc = withHead("Message Header\nSender : TESTBDDHXXX\nReceiver : TESTCNSHXXX");
    expect(lc.issuingCountry).toBe("BD");
    expect(lc.issuingCountrySource).toBe("header");
  });
  it("52D 自由文本里的国家名", () => {
    const lc = withHead("", "\n:52D:SOME BANK LIMITED\nHEAD OFFICE\nDHAKA, BANGLADESH");
    expect(lc.issuingCountry).toBe("BD");
    expect(lc.issuingCountrySource).toBe("52D");
  });
  it("52D 里 HOLDINGS 之类的 8 字母单词不当成 BIC", () => {
    const lc = withHead("", "\n:52D:ABC HOLDINGS BANK\nISTANBUL");
    expect(lc.issuingCountry).toBe("TR");
  });
  it("都没有时按申请人地址推断，并标明来源", () => {
    const lc = parseMt700(SAMPLE_MT700.replace("123 MAIN STREET, NEW YORK", "HOUSE 5, ROAD 2, GULSHAN, DHAKA-1212, BANGLADESH"));
    expect(lc.issuingCountry).toBe("BD");
    expect(lc.issuingCountrySource).toBe("applicant");
  });
  it("52A 是合法 BIC 时优先于其他来源", () => {
    const lc = withHead("Sender : TESTTRISXXX", "\n:52A:TESTBDDHXXX");
    expect(lc.issuingCountry).toBe("BD");
    expect(lc.issuingCountrySource).toBe("52A");
  });
});
