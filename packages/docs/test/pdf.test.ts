import { describe, expect, it } from "vitest";
import { AppError } from "@lc/core";
import { extractPdfText, extractPlainText } from "../src";
import { INVOICE_LINES, makePdf } from "./make-pdf";

describe("extractPdfText", () => {
  it("提取文字层，按行重组并保持阅读顺序", async () => {
    const r = await extractPdfText(await makePdf([INVOICE_LINES]));
    expect(r.kind).toBe("pdf");
    expect(r.needsOcr).toBe(false);
    const lines = r.text.split("\n");
    expect(lines[0]).toBe("COMMERCIAL INVOICE");
    expect(lines[1]).toBe("Invoice No: INV-2024-0099 Date: 2024-08-12");
    expect(lines.at(-1)).toBe("Total Amount: USD 98,500.50");
  });

  it("多页按页返回", async () => {
    const r = await extractPdfText(
      await makePdf([[[60, 780, "Page one has plenty of words in it to count as text"]], [[60, 780, "Page two also has plenty of words in it as well"]]]),
    );
    expect(r.pages).toHaveLength(2);
    expect(r.pages[1]).toContain("Page two");
  });

  it("几乎没有文字的 PDF 标记为疑似扫描件", async () => {
    const r = await extractPdfText(await makePdf([[]]));
    expect(r.chars).toBe(0);
    expect(r.needsOcr).toBe(true);
  });

  it("不会改动调用方传入的缓冲区", async () => {
    const data = await makePdf([INVOICE_LINES]);
    const before = data.byteLength;
    await extractPdfText(data);
    expect(data.byteLength).toBe(before);
  });

  it("损坏文件抛出带编码的错误", async () => {
    await expect(extractPdfText(new TextEncoder().encode("not a pdf"))).rejects.toMatchObject({ code: "doc.pdfInvalid" });
    await expect(extractPdfText(new Uint8Array())).rejects.toBeInstanceOf(AppError);
  });
});

describe("extractPlainText", () => {
  it("统一换行并统计字符", () => {
    const r = extractPlainText("A B\r\nC\r\n");
    expect(r.text).toBe("A B\nC");
    expect(r.chars).toBe(3);
    expect(r.needsOcr).toBe(false);
  });
});
