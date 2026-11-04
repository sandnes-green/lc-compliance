import { describe, expect, it, vi } from "vitest";
import type { OcrResult } from "@lc/docs";
import { CaseStore } from "@lc/storage";
import { DEFAULT_OCR_LANGS, getOcrLangs, importDocument, saveOcrLangs, type OcrRunner } from "../src";
import { makePdf } from "../../docs/test/make-pdf";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const ocrResult = (kind: "pdf" | "image", text: string, confidence: number): OcrResult => ({
  kind,
  pages: [text],
  text,
  chars: text.replace(/\s/g, "").length,
  needsOcr: false,
  confidence,
  pageConfidence: [confidence],
});

const runner = (over: Partial<OcrRunner> = {}): OcrRunner & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    pdf: async () => (calls.push("pdf"), ocrResult("pdf", "SCANNED INVOICE Total USD 100.00", 91.5)),
    image: async () => (calls.push("image"), ocrResult("image", "PHOTO OF B/L Port of Loading SHANGHAI", 77)),
    ...over,
  };
};

const setup = () => {
  const store = new CaseStore();
  const c = store.createCase({ name: "n", lcText: ":20:X\n:32B:USD1,00" });
  return { store, caseId: c.id };
};

describe("importDocument + OCR", () => {
  it("扫描件 PDF（无文字层）自动走 OCR，并记录置信度", async () => {
    const { store, caseId } = setup();
    const ocr = runner();
    const d = await importDocument(store, { caseId, docType: "invoice", fileName: "scan.pdf", data: await makePdf([[]]) }, ocr);
    expect(ocr.calls).toEqual(["pdf"]);
    expect(d.sourceKind).toBe("pdf");
    expect(d.needsOcr).toBe(false);
    expect(d.ocrConfidence).toBe(91.5);
    expect(store.getDocumentText(d.id).text).toContain("SCANNED INVOICE");
  });

  it("带文字层的 PDF 不会触发 OCR", async () => {
    const { store, caseId } = setup();
    const ocr = runner();
    const { INVOICE_LINES } = await import("../../docs/test/make-pdf");
    const d = await importDocument(store, { caseId, docType: "invoice", fileName: "a.pdf", data: await makePdf([INVOICE_LINES]) }, ocr);
    expect(ocr.calls).toEqual([]);
    expect(d.ocrConfidence).toBeNull();
  });

  it("图片文件走 OCR，来源记为 image", async () => {
    const { store, caseId } = setup();
    const ocr = runner();
    const d = await importDocument(store, { caseId, docType: "transport", fileName: "bl.png", data: PNG }, ocr);
    expect(ocr.calls).toEqual(["image"]);
    expect(d.sourceKind).toBe("image");
    expect(d.ocrConfidence).toBe(77);
  });

  it("没有 OCR 能力时：图片报错；扫描件仍入库但标记需要 OCR", async () => {
    const { store, caseId } = setup();
    await expect(importDocument(store, { caseId, docType: "invoice", fileName: "x.png", data: PNG })).rejects.toMatchObject({ code: "ocr.unavailable" });
    const d = await importDocument(store, { caseId, docType: "invoice", fileName: "s.pdf", data: await makePdf([[]]) });
    expect(d.needsOcr).toBe(true);
    expect(d.ocrConfidence).toBeNull();
  });

  it("OCR 失败（或被取消）时不留下任何记录，错误原样抛出", async () => {
    const { store, caseId } = setup();
    const ocr = runner({ pdf: vi.fn().mockRejectedValue(Object.assign(new Error("取消"), { code: "ocr.cancelled" })) });
    await expect(importDocument(store, { caseId, docType: "invoice", fileName: "s.pdf", data: await makePdf([[]]) }, ocr)).rejects.toMatchObject({ code: "ocr.cancelled" });
    expect(store.listDocuments(caseId)).toEqual([]);
  });

  it("案件不存在时先失败，不白跑 OCR", async () => {
    const { store } = setup();
    const ocr = runner();
    await expect(importDocument(store, { caseId: "nope", docType: "invoice", fileName: "bl.png", data: PNG }, ocr)).rejects.toMatchObject({ code: "case.notFound" });
    expect(ocr.calls).toEqual([]);
  });
});

describe("OCR 语言设置", () => {
  it("默认英文；可保存合法组合并规范化；非法值被拒绝且不改动原设置", () => {
    const { store } = setup();
    expect(getOcrLangs(store)).toBe(DEFAULT_OCR_LANGS);
    expect(saveOcrLangs(store, "eng+chi_sim+eng")).toBe("eng+chi_sim");
    expect(getOcrLangs(store)).toBe("eng+chi_sim");
    expect(() => saveOcrLangs(store, "../etc/passwd")).toThrowError(expect.objectContaining({ code: "ocr.langUnsupported" }));
    expect(getOcrLangs(store)).toBe("eng+chi_sim");
  });

  it("库里的值被改坏时回退到默认，而不是让 OCR 整体不可用", () => {
    const { store } = setup();
    store.setSetting("ocr.langs", "evil+lang");
    expect(getOcrLangs(store)).toBe("eng");
  });
});
