import { AppError } from "@lc/core";

export interface ExtractedDocument {
  kind: "pdf" | "text" | "image" | "docx";
  pages: string[];
  /** 全部页面文字，页间以空行分隔 */
  text: string;
  /** 非空白字符数 */
  chars: number;
  /** 有页面但几乎没有文字层，疑似扫描件，需要 OCR */
  needsOcr: boolean;
}

const MAX_PAGES = 50;
/** 平均每页少于该字符数视为无文字层 */
const MIN_CHARS_PER_PAGE = 40;
const LINE_TOLERANCE = 3;

const nonSpace = (s: string) => s.replace(/\s/g, "").length;

export function extractPlainText(raw: string): ExtractedDocument {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  const chars = nonSpace(text);
  return { kind: "text", pages: [text], text, chars, needsOcr: false };
}

interface Item {
  str: string;
  x: number;
  y: number;
  w: number;
}

/** 按纵坐标把文字片段归并成行，行内按横坐标排序；相隔较远的片段以空格分开 */
function itemsToText(items: Item[]): string {
  const lines: { y: number; items: Item[] }[] = [];
  for (const it of items) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= LINE_TOLERANCE);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  return lines
    .map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      let out = "";
      let prevEnd: number | null = null;
      for (const it of l.items) {
        if (prevEnd !== null && it.x - prevEnd > 1 && !out.endsWith(" ") && !it.str.startsWith(" ")) out += " ";
        out += it.str;
        prevEnd = it.x + it.w;
      }
      return out.trim();
    })
    .filter(Boolean)
    .join("\n");
}

export async function extractPdfText(data: Uint8Array): Promise<ExtractedDocument> {
  // 动态导入：pdfjs 为纯 ESM，且仅在需要时加载
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(data), // pdfjs 会转移底层缓冲区，传入副本
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") throw new AppError("doc.pdfEncrypted", "PDF 已加密，无法读取");
    throw new AppError("doc.pdfInvalid", "无法解析该 PDF 文件");
  }

  try {
    if (doc.numPages > MAX_PAGES) {
      throw new AppError("doc.tooManyPages", `页数过多（${doc.numPages} 页，上限 ${MAX_PAGES}）`, { pages: doc.numPages, max: MAX_PAGES });
    }
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: Item[] = [];
      for (const raw of content.items) {
        if (!("str" in raw) || raw.str === "") continue;
        items.push({ str: raw.str, x: raw.transform[4] ?? 0, y: raw.transform[5] ?? 0, w: raw.width ?? 0 });
      }
      pages.push(itemsToText(items));
      page.cleanup();
    }
    const text = pages.join("\n\n").trim();
    const chars = nonSpace(text);
    return { kind: "pdf", pages, text, chars, needsOcr: chars < MIN_CHARS_PER_PAGE * pages.length };
  } finally {
    await task.destroy();
  }
}
