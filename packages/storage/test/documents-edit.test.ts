import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CaseStore } from "../src";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

const setup = () => {
  const s = new CaseStore();
  const c = s.createCase({ name: "n", lcText: ":20:X\n:32B:USD1,00" });
  const d = s.addDocument({ caseId: c.id, docType: "invoice", fileName: "scan.png", sourceKind: "image", text: "Total USD 1OO.00", chars: 14, needsOcr: false, ocrConfidence: 72.5 });
  return { s, c, d };
};

describe("OCR 文档", () => {
  it("记录来源与置信度", () => {
    const { d } = setup();
    expect(d.sourceKind).toBe("image");
    expect(d.ocrConfidence).toBe(72.5);
  });

  it("人工修正文字：更新字数、作废旧的 AI 抽取结果，审计不含正文", () => {
    const { s, c, d } = setup();
    s.saveExtraction(d.id, { fields: { amount: { value: "100.00", quote: "USD 1OO.00" } }, rejected: [] });
    expect(s.listDocuments(c.id)[0]!.extraction).not.toBeNull();

    const updated = s.updateDocumentText(d.id, "Total USD 100.00");
    expect(updated.extraction).toBeNull();
    expect(updated.extractedAt).toBeNull();
    expect(updated.chars).toBe(14);
    expect(updated.ocrConfidence).toBe(72.5); // 置信度属于原始识别结果，保留
    expect(s.getDocumentText(d.id).text).toBe("Total USD 100.00");

    const audit = JSON.stringify(s.listAudit());
    expect(audit).toContain("document.edit");
    expect(audit).not.toContain("Total USD 100.00");
    expect(s.verifyAudit()).toBeNull();
  });

  it("清空文字被拒绝；文档不存在报明确错误", () => {
    const { s, d } = setup();
    expect(() => s.updateDocumentText(d.id, "  \n ")).toThrowError(expect.objectContaining({ code: "doc.empty" }));
    expect(s.getDocumentText(d.id).text).toBe("Total USD 1OO.00");
    expect(() => s.updateDocumentText("nope", "x")).toThrowError(expect.objectContaining({ code: "doc.notFound" }));
  });

  it("旧库（documents 无 ocr_confidence 列）自动迁移", () => {
    const dir = mkdtempSync(join(tmpdir(), "lc-migrate3-"));
    try {
      const file = join(dir, "old.db");
      const first = new CaseStore(file);
      const c = first.createCase({ name: "n", lcText: ":20:X\n:32B:USD1,00" });
      first.addDocument({ caseId: c.id, docType: "invoice", fileName: "a.txt", sourceKind: "text", text: "x", chars: 1, needsOcr: false });
      first.close();
      const raw = new DatabaseSync(file);
      raw.exec("ALTER TABLE documents DROP COLUMN ocr_confidence");
      raw.close();

      const s = new CaseStore(file);
      expect(s.listDocuments(c.id)[0]!.ocrConfidence).toBeNull();
      s.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
