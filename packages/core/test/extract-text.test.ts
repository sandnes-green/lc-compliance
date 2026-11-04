import { describe, expect, it } from "vitest";
import { extractFields, toInsuranceData, toInvoiceData, toTransportData } from "../src";
import type { LlmClient, LlmMessage } from "../src";

const fake = (fields: unknown, seen?: LlmMessage[][]): LlmClient => ({
  completeJson: async (m) => {
    seen?.push(m);
    return { fields };
  },
});

const INVOICE = `COMMERCIAL INVOICE
Seller: SANDNES TRADING CO LTD
Buyer:  ACME IMPORTS INC
Description of goods: 1000 SETS OF WIDGETS MODEL X
CIF NEW YORK
Total Amount: USD 98,500.50`;

describe("文本类字段抽取", () => {
  it("值是引用的一部分才被采纳（多行货描、忽略空白与大小写）", async () => {
    const r = await extractFields(
      fake([
        { name: "sellerName", value: "SANDNES TRADING CO LTD", quote: "Seller: SANDNES TRADING CO LTD" },
        { name: "buyerName", value: "Acme Imports Inc", quote: "Buyer: ACME IMPORTS INC" },
        { name: "goodsDescription", value: "1000 SETS OF WIDGETS MODEL X\nCIF NEW YORK", quote: "1000 SETS OF WIDGETS MODEL X\nCIF NEW YORK" },
      ]),
      "invoice",
      INVOICE,
    );
    expect(r.rejected).toEqual([]);
    expect(toInvoiceData(r)).toMatchObject({
      sellerName: "SANDNES TRADING CO LTD",
      goodsDescription: "1000 SETS OF WIDGETS MODEL X\nCIF NEW YORK",
    });
  });

  it("值不在引用里（模型改写或编造）→ 拒绝", async () => {
    const r = await extractFields(
      fake([{ name: "sellerName", value: "SANDNES EXPORT GROUP", quote: "Seller: SANDNES TRADING CO LTD" }]),
      "invoice",
      INVOICE,
    );
    expect(r.fields).toEqual({});
    expect(r.rejected).toEqual([{ name: "sellerName", code: "valueNotInQuote", reason: "内容未出现在引用中" }]);
  });

  it("空值、过长的值 → 拒绝", async () => {
    const long = "A".repeat(601);
    const r = await extractFields(
      fake([
        { name: "buyerName", value: "", quote: "Buyer:" },
        { name: "goodsDescription", value: long, quote: long },
      ]),
      "invoice",
      `Buyer:\n${long}`,
    );
    expect(r.rejected.map((x) => x.code)).toEqual(["badText", "badText"]);
  });
});

describe("按单据类型的抽取范围", () => {
  it("运输单据：日期与港口", async () => {
    const text = "BILL OF LADING\nPort of Loading: SHANGHAI, CHINA\nPort of Discharge: NEW YORK\nShipped on board 2024-08-10";
    const r = await extractFields(
      fake([
        { name: "portOfLoading", value: "SHANGHAI, CHINA", quote: "Port of Loading: SHANGHAI, CHINA" },
        { name: "portOfDischarge", value: "NEW YORK", quote: "Port of Discharge: NEW YORK" },
        { name: "shipmentDate", value: "2024-08-10", quote: "Shipped on board 2024-08-10" },
        { name: "sellerName", value: "X", quote: "BILL OF LADING" }, // 提单的抽取范围里没有
      ]),
      "transport",
      text,
    );
    expect(toTransportData(r)).toEqual({ shipmentDate: "2024-08-10", portOfLoading: "SHANGHAI, CHINA", portOfDischarge: "NEW YORK" });
    expect(r.rejected).toEqual([{ name: "sellerName", code: "outOfScope", reason: "不在抽取范围内" }]);
  });

  it("保险单：币种、投保金额、日期；提示词按保险单生成", async () => {
    const seen: LlmMessage[][] = [];
    const text = "INSURANCE POLICY\nSum insured: USD 108,350.55\nDate of issue: 2024-08-09";
    const r = await extractFields(
      fake(
        [
          { name: "currency", value: "USD", quote: "Sum insured: USD 108,350.55" },
          { name: "amount", value: "108350.55", quote: "Sum insured: USD 108,350.55" },
          { name: "date", value: "2024-08-09", quote: "Date of issue: 2024-08-09" },
        ],
        seen,
      ),
      "insurance",
      text,
    );
    expect(toInsuranceData(r)).toEqual({ currency: "USD", amount: 108350.55, date: "2024-08-09" });
    expect(seen[0]![0]!.content).toMatch(/sum insured/i);
  });
});
