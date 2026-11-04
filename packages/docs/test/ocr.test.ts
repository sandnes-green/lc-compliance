import { createCanvas } from "@napi-rs/canvas";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { detectImageKind, extractPdfText, ocrImage, ocrPdf, parseOcrLangs, prepareLangDir, type OcrProgress } from "../src";

// 这里使用真实的 OCR 引擎与语言包（不模拟），验证渲染 → 识别的完整链路
const resolve = (id: string, from: string) => createRequire(join(from, "x.js")).resolve(id);
const ANCHOR = join(__dirname, "..");

let dir: string;
let langPath: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "lc-ocr-"));
  langPath = prepareLangDir(join(dir, "lang"), "eng", ANCHOR, resolve);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** 合成「扫描件」：白底黑字的位图（非真实数据） */
function scanPng(lines: string[]): Buffer {
  const c = createCanvas(1400, 120 + lines.length * 90);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#000";
  g.font = "bold 52px Arial";
  lines.forEach((l, i) => g.fillText(l, 60, 100 + i * 90));
  return c.toBuffer("image/png");
}

/** 只含一张图片、没有任何文字层的 PDF，即典型的扫描件 */
async function scannedPdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const lines of pages) {
    const img = await doc.embedPng(scanPng(lines));
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 20, y: 842 - 20 - 595 * (img.height / img.width), width: 555, height: 555 * (img.height / img.width) });
  }
  return doc.save();
}

const squash = (s: string) => s.replace(/\s+/g, "");

describe("工具函数", () => {
  it("语言白名单：拒绝路径穿越与未知语言", () => {
    expect(parseOcrLangs("eng+chi_sim")).toEqual(["eng", "chi_sim"]);
    expect(parseOcrLangs("eng+eng")).toEqual(["eng"]);
    expect(() => parseOcrLangs("../evil")).toThrowError(expect.objectContaining({ code: "ocr.langUnsupported" }));
    expect(() => parseOcrLangs("")).toThrowError(expect.objectContaining({ code: "ocr.langUnsupported" }));
    expect(() => parseOcrLangs("eng+fra")).toThrow();
  });

  it("按文件头识别图片类型", () => {
    expect(detectImageKind(scanPng(["a"]))).toBe("png");
    expect(detectImageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("jpeg");
    expect(detectImageKind(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe("bmp");
    expect(detectImageKind(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });

  it("语言包目录只复制一次，缺失的语言包报明确错误", () => {
    expect(prepareLangDir(join(dir, "lang"), "eng", ANCHOR, resolve)).toBe(join(dir, "lang"));
    expect(() =>
      prepareLangDir(join(dir, "lang2"), "chi_sim", ANCHOR, () => {
        throw new Error("not installed");
      }),
    ).toThrowError(expect.objectContaining({ code: "ocr.langMissing" }));
  });
});

describe("OCR（真实引擎）", () => {
  it("识别图片中的金额与日期", async () => {
    const r = await ocrImage(scanPng(["COMMERCIAL INVOICE", "Date: 2024-08-12", "Total Amount: USD 98,500.50"]), { langs: "eng", langPath });
    const t = squash(r.text);
    expect(t).toContain("COMMERCIALINVOICE");
    expect(t).toContain("98,500.50");
    expect(t).toContain("2024-08-12");
    expect(r.kind).toBe("image");
    expect(r.confidence).toBeGreaterThan(60);
    expect(r.pages).toHaveLength(1);
  }, 120_000);

  it("扫描件 PDF：没有文字层，OCR 后得到文字并按页报告进度", async () => {
    const pdf = await scannedPdf([["PACKING LIST", "Total Amount: USD 11,200.00"], ["BILL OF LADING", "Port of Loading: SHANGHAI"]]);
    expect((await extractPdfText(pdf)).needsOcr).toBe(true);

    const seen: OcrProgress[] = [];
    const r = await ocrPdf(pdf, { langs: "eng", langPath, onProgress: (p) => seen.push(p) });
    expect(r.kind).toBe("pdf");
    expect(r.pages).toHaveLength(2);
    expect(squash(r.pages[0]!)).toContain("11,200.00");
    expect(squash(r.pages[1]!)).toContain("SHANGHAI");
    expect(r.pageConfidence).toHaveLength(2);
    // 进度：两页都出现过，且每页都到达 100
    expect(new Set(seen.map((p) => p.page))).toEqual(new Set([1, 2]));
    expect(seen.filter((p) => p.percent === 100).map((p) => p.page)).toEqual([1, 2]);
    expect(seen.every((p) => p.pages === 2)).toBe(true);
  }, 180_000);

  it("取消：已取消的信号立即终止；多页时在页间生效", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(ocrImage(scanPng(["x"]), { langs: "eng", langPath, signal: ac.signal })).rejects.toMatchObject({ code: "ocr.cancelled" });

    const pdf = await scannedPdf([["PAGE ONE TEXT"], ["PAGE TWO TEXT"]]);
    const mid = new AbortController();
    const pages: number[] = [];
    await expect(
      ocrPdf(pdf, {
        langs: "eng",
        langPath,
        signal: mid.signal,
        onProgress: (p) => {
          pages.push(p.page);
          if (p.page === 1 && p.percent === 100) mid.abort(); // 第 1 页完成后取消
        },
      }),
    ).rejects.toMatchObject({ code: "ocr.cancelled" });
    expect(pages).not.toContain(2);
  }, 180_000);

  it("空白页没有文字时给出明确错误", async () => {
    const c = createCanvas(600, 300);
    const g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, 600, 300);
    await expect(ocrImage(c.toBuffer("image/png"), { langs: "eng", langPath })).rejects.toMatchObject({ code: "ocr.noText" });
  }, 120_000);

  it("不是图片的数据被拒绝", async () => {
    await expect(ocrImage(new TextEncoder().encode("hello"), { langs: "eng", langPath })).rejects.toMatchObject({ code: "doc.unsupported" });
  });
});
