import { AppError } from "@lc/core";
import { detectImageKind, extractDocxText, extractPdfText, extractPlainText, isZip, type ExtractedDocument, type OcrResult } from "@lc/docs";
import type { CaseStore, DocKind, DocumentRecord } from "@lc/storage";

export const MAX_DOC_BYTES = 20 * 1024 * 1024;

/** 文字识别能力（由应用层绑定语言、语言包路径、进度回调与取消信号后传入） */
export interface OcrRunner {
  image(data: Uint8Array): Promise<OcrResult>;
  pdf(data: Uint8Array): Promise<OcrResult>;
}

const isPdf = (data: Uint8Array) => data.length >= 5 && String.fromCharCode(...data.subarray(0, 5)) === "%PDF-";

export interface FileText {
  doc: ExtractedDocument;
  /** 经 OCR 识别时的平均置信度；非 OCR 来源为 null */
  ocrConfidence: number | null;
}

/**
 * 从文件内容提取文字（按内容而非扩展名判断类型）：
 * - 带文字层的 PDF、文本文件、Word(.docx)：直接取文字
 * - 没有文字层的 PDF（扫描件）、PNG/JPEG/BMP 图片：走 OCR（未提供 ocr 时，扫描件仍返回并标记 needsOcr，图片则报错）
 */
export async function extractFileText(data: Uint8Array, fileName: string, ocr?: OcrRunner): Promise<FileText> {
  if (data.byteLength > MAX_DOC_BYTES) {
    throw new AppError("doc.tooLarge", `文件过大：${fileName}`, { name: fileName, maxMb: MAX_DOC_BYTES / 1024 / 1024 });
  }

  if (isPdf(data)) {
    const doc = await extractPdfText(data);
    if (doc.needsOcr && ocr) {
      const r = await ocr.pdf(data);
      return { doc: r, ocrConfidence: r.confidence };
    }
    return { doc, ocrConfidence: null };
  }
  if (detectImageKind(data)) {
    if (!ocr) throw new AppError("ocr.unavailable", "文字识别不可用，无法导入图片", {});
    const r = await ocr.image(data);
    return { doc: r, ocrConfidence: r.confidence };
  }
  if (isZip(data)) return { doc: await extractDocxText(data), ocrConfidence: null };

  if (data.includes(0)) throw new AppError("doc.unsupported", `不支持的文件类型：${fileName}`, { name: fileName });
  const doc = extractPlainText(new TextDecoder("utf-8").decode(data));
  if (doc.chars === 0) throw new AppError("doc.empty", `文件内容为空：${fileName}`, { name: fileName });
  return { doc, ocrConfidence: null };
}

/** 导入单据文件，提取文字后入库 */
export async function importDocument(
  store: CaseStore,
  input: { caseId: string; docType: DocKind; fileName: string; data: Uint8Array },
  ocr?: OcrRunner,
): Promise<DocumentRecord> {
  // 先确认案件存在，避免白白跑完 OCR 才发现无处可存
  if (!store.getCase(input.caseId)) throw new AppError("case.notFound", `案件不存在：${input.caseId}`, { id: input.caseId });
  const { doc, ocrConfidence } = await extractFileText(input.data, input.fileName, ocr);

  return store.addDocument({
    caseId: input.caseId,
    docType: input.docType,
    fileName: input.fileName,
    sourceKind: doc.kind === "docx" ? "text" : doc.kind,
    text: doc.text,
    chars: doc.chars,
    needsOcr: doc.needsOcr,
    ocrConfidence,
  });
}
