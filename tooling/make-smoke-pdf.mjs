// 生成冒烟自检用的合成单据（非真实数据）：
//   invoice.pdf —— 带文字层的发票
//   scan.pdf    —— 只有一张位图、没有文字层的「扫描件」发票
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";

const out = (name) => new URL(`../apps/desktop/smoke/${name}`, import.meta.url);

const lines = [
  [60, 780, "COMMERCIAL INVOICE"],
  [60, 750, "Date: 2024-08-12"],
  [60, 720, "Seller: SANDNES TRADING CO LTD"],
  [60, 690, "Bank account 6222020200112233445"],
  [60, 660, "Total Amount:"],
  [160, 660, "USD 98,500.50"],
];

// 带文字层
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  for (const [x, y, t] of lines) page.drawText(t, { x, y, size: 11, font });
  writeFileSync(out("invoice.pdf"), await doc.save());
}

// 扫描件：把文字画成位图再放进 PDF
{
  const c = createCanvas(1400, 620);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.font = "bold 52px Arial";
  ["COMMERCIAL INVOICE", "Date: 2024-08-12", "Seller: SANDNES TRADING CO LTD", "Total Amount: USD 98,500.50"].forEach((l, i) => g.fillText(l, 60, 100 + i * 100));
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(c.toBuffer("image/png"));
  const page = doc.addPage([595, 842]);
  const w = 555;
  const h = w * (img.height / img.width);
  page.drawImage(img, { x: 20, y: 842 - 20 - h, width: w, height: h });
  writeFileSync(out("scan.pdf"), await doc.save());
}
