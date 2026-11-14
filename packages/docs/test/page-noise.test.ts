import { describe, expect, it } from "vitest";
import { stripPageNoise } from "../src";

/** 取自银行打印的信用证：每页开头是同一组页眉，结尾是同一组页脚（页码不同） */
const head = ["149 SG REL.DATE=060726 REL.TIME=203610 DEAL=149113239934-M ISS000", "MT700 ARR.DATE=260706", "STANDARD CHARTERED BANK", "DHAKA", "-----------------------------------------------------------------"];
const foot = (n: number) => ["-----------------------------------------------------------------", "THIS CREDIT IS VALID ONLY WHEN USED IN CONJUNCTION WITH OUR", "NOTIFICATION OF LC ADVICE NO. 149113239934-M DATED 06/07/26", `PAGE ${n}/...TO BE CONTINUED ON NEXT PAGE.`];
const page = (n: number, body: string[]) => [...head, ...body, ...foot(n)].join("\n");

describe("stripPageNoise", () => {
  it("去掉每页重复的页眉页脚，保留正文并把跨页的条款接起来", () => {
    const pages = [
      page(1, [":20: DOCUMENTARY CREDIT NUMBER", "411012647150-S", "+FULL SET OF CLEAN SHIPPED ON BOARD MARINE/OCEAN BILL OF LADING"]),
      page(2, ["MADE OUT TO THE ORDER OF STANDARD CHARTERED BANK,", "DHAKA,BANGLADESH"]),
      page(3, ["+ INSURANCE WILL BE ATTENDED BY THE APPLICANT."]),
    ];
    const text = stripPageNoise(pages);
    expect(text).not.toContain("REL.DATE");
    expect(text).not.toContain("THIS CREDIT IS VALID ONLY");
    expect(text).not.toContain("PAGE ");
    expect(text.split("\n")).not.toContain("DHAKA"); // 页眉第二行（5 个字符）也要去掉
    expect(text.split("\n")).not.toContain("STANDARD CHARTERED BANK"); // 页眉里的行；正文里同一个词的行内容不同，不受影响
    expect(text).toContain("+FULL SET OF CLEAN SHIPPED ON BOARD MARINE/OCEAN BILL OF LADING");
    expect(text).toContain("MADE OUT TO THE ORDER OF STANDARD CHARTERED BANK,");
    expect(text).toContain("+ INSURANCE WILL BE ATTENDED BY THE APPLICANT.");
  });

  it("单行页眉 CONFIDENTIAL 也去掉", () => {
    const text = stripPageNoise(["CONFIDENTIAL\n:20: X\nLINE A", "CONFIDENTIAL\nLINE B\nLINE C"]);
    expect(text).toBe(":20: X\nLINE A\n\nLINE B\nLINE C");
  });

  it("正文里恰好重复的行（不在页眉页脚区域）不会被删", () => {
    const rep = "NUMBER, APPLICANT'S TAX IDENTIFICATION NUMBER (TIN) AS MENTIONED";
    const filler = (p: number) => Array.from({ length: 20 }, (_, i) => `p${p} line ${i} unique text here`);
    const pages = [[...filler(1).slice(0, 10), rep, ...filler(1).slice(10)].join("\n"), [...filler(2).slice(0, 10), rep, ...filler(2).slice(10)].join("\n")];
    expect(stripPageNoise(pages).split(rep).length - 1).toBe(2);
  });

  it("只有一页时原样返回", () => {
    expect(stripPageNoise(["CONFIDENTIAL\nA"])).toBe("CONFIDENTIAL\nA");
  });
});
