import { describe, expect, it } from "vitest";
import { CaseStore } from "@lc/storage";
import { MAX_DOC_BYTES, importDocument } from "../src";
import { INVOICE_LINES, makePdf } from "../../docs/test/make-pdf";

const setup = () => {
  const store = new CaseStore();
  const c = store.createCase({ name: "n", lcText: ":20:X\n:32B:USD1,00" });
  return { store, caseId: c.id };
};
const enc = (s: string) => new TextEncoder().encode(s);

describe("importDocument", () => {
  it("PDF 按内容识别并提取文字（与扩展名无关）", async () => {
    const { store, caseId } = setup();
    const r = await importDocument(store, { caseId, docType: "invoice", fileName: "scan001.dat", data: await makePdf([INVOICE_LINES]) });
    expect(r.sourceKind).toBe("pdf");
    expect(r.needsOcr).toBe(false);
    expect(store.getDocumentText(r.id).text).toContain("Total Amount: USD 98,500.50");
  });

  it("无文字层的 PDF 导入成功但标记需要 OCR", async () => {
    const { store, caseId } = setup();
    const r = await importDocument(store, { caseId, docType: "transport", fileName: "bl.pdf", data: await makePdf([[]]) });
    expect(r.needsOcr).toBe(true);
  });

  it("文本文件可导入；空文件、二进制、超大文件被拒绝", async () => {
    const { store, caseId } = setup();
    const ok = await importDocument(store, { caseId, docType: "invoice", fileName: "a.txt", data: enc("Total: USD 1") });
    expect(ok.sourceKind).toBe("text");
    await expect(importDocument(store, { caseId, docType: "invoice", fileName: "e.txt", data: enc("  \n ") })).rejects.toMatchObject({ code: "doc.empty" });
    await expect(importDocument(store, { caseId, docType: "invoice", fileName: "x.bin", data: new Uint8Array([1, 0, 2]) })).rejects.toMatchObject({ code: "doc.unsupported" });
    await expect(importDocument(store, { caseId, docType: "invoice", fileName: "big.txt", data: new Uint8Array(MAX_DOC_BYTES + 1) })).rejects.toMatchObject({ code: "doc.tooLarge" });
    expect(store.listDocuments(caseId)).toHaveLength(1);
  });

  it("案件不存在时不保留任何记录", async () => {
    const { store } = setup();
    await expect(importDocument(store, { caseId: "nope", docType: "invoice", fileName: "a.txt", data: enc("x") })).rejects.toMatchObject({ code: "case.notFound" });
  });
});
