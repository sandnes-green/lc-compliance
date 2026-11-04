import { PDFDocument, StandardFonts } from "pdf-lib";

/** 生成仅含西文字符的合成 PDF（每个元素为一页，元素内为若干 [x, y, 文字]） */
export async function makePdf(pages: [number, number, string][][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const items of pages) {
    const page = doc.addPage([595, 842]);
    for (const [x, y, text] of items) page.drawText(text, { x, y, size: 11, font });
  }
  return doc.save();
}

/** 合成商业发票（非真实数据） */
export const INVOICE_LINES: [number, number, string][] = [
  [60, 780, "COMMERCIAL INVOICE"],
  [60, 750, "Invoice No: INV-2024-0099"],
  [350, 750, "Date: 2024-08-12"],
  [60, 720, "Seller: SANDNES TRADING CO LTD"],
  [60, 690, "Description: 1000 SETS OF WIDGETS MODEL X"],
  [60, 660, "Total Amount:"],
  [160, 660, "USD 98,500.50"],
];
