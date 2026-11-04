import JSZip from "jszip";
import { AppError } from "@lc/core";
import type { ExtractedDocument } from "./pdf";

/** document.xml 解压后的体积上限，防止压缩炸弹 */
const MAX_XML_BYTES = 20 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });

export const isZip = (d: Uint8Array) => d.length > 4 && d[0] === 0x50 && d[1] === 0x4b && d[2] === 0x03 && d[3] === 0x04;

/**
 * 提取 Word (.docx) 的正文文字：段落换行、表格单元格以制表符分隔。
 * 只用正则处理 XML（不使用 XML 解析器），因此不存在外部实体（XXE）类风险。
 */
export async function extractDocxText(data: Uint8Array): Promise<ExtractedDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new AppError("doc.docxInvalid", "无法解析该 Word 文件", {});
  }
  const entry = zip.file("word/document.xml");
  if (!entry) throw new AppError("doc.docxInvalid", "无法解析该 Word 文件", {});
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === "number" && declared > MAX_XML_BYTES) throw new AppError("doc.tooLarge", "Word 文件内容过大", { name: "docx", maxMb: MAX_XML_BYTES / 1024 / 1024 });

  const xml = await entry.async("string");
  if (xml.length > MAX_XML_BYTES) throw new AppError("doc.tooLarge", "Word 文件内容过大", { name: "docx", maxMb: MAX_XML_BYTES / 1024 / 1024 });

  const text = decode(
    xml
      .replace(/<w:tab\s*\/>/g, "\t")
      .replace(/<w:br\s*\/>|<w:cr\s*\/>/g, "\n")
      .replace(/<\/w:p>\s*<\/w:tc>/g, "</w:tc>") // 单元格最后一段不换行，避免表格被拆散
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const chars = text.replace(/\s/g, "").length;
  if (chars === 0) throw new AppError("doc.empty", "文件内容为空", {});
  return { kind: "docx", pages: [text], text, chars, needsOcr: false };
}
