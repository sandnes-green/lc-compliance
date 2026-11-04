import { AppError } from "@lc/core";
import type { ExtractedDocument } from "./pdf";

/** 受支持的 OCR 语言（语言包随应用分发，无需联网下载） */
export const OCR_LANGS = ["eng", "chi_sim"] as const;
export type OcrLang = (typeof OCR_LANGS)[number];

export interface OcrProgress {
  /** 正在识别第几页（从 1 起）与总页数 */
  page: number;
  pages: number;
  /** 当前页内的进度 0..100 */
  percent: number;
}

export interface OcrOptions {
  /** 如 "eng" 或 "eng+chi_sim" */
  langs: string;
  /** 存放 <lang>.traineddata.gz 的目录 */
  langPath: string;
  onProgress?: (p: OcrProgress) => void;
  /** 取消信号：在页与页之间检查，已开始识别的这一页会先完成 */
  signal?: AbortSignal;
  /** PDF 渲染倍率（1 = 72dpi）。2.5 约 180dpi，兼顾速度与识别率 */
  scale?: number;
}

export interface OcrResult extends ExtractedDocument {
  /** 全部页面的平均置信度 0..100 */
  confidence: number;
  pageConfidence: number[];
}

const MAX_PAGES = 30;
const MAX_PIXELS = 40_000_000;
const DEFAULT_SCALE = 2.5;

/** 校验并规范化语言串；非白名单语言一律拒绝（语言名会拼进文件路径） */
export function parseOcrLangs(langs: string): OcrLang[] {
  const list = langs.split("+").filter(Boolean);
  if (list.length === 0 || !list.every((l): l is OcrLang => (OCR_LANGS as readonly string[]).includes(l))) {
    throw new AppError("ocr.langUnsupported", `不支持的 OCR 语言：${langs}`, { langs });
  }
  return [...new Set(list)];
}

export type ImageKind = "png" | "jpeg" | "bmp";

/** 按文件头识别图片类型，不依赖扩展名 */
export function detectImageKind(d: Uint8Array): ImageKind | null {
  if (d.length > 8 && d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return "png";
  if (d.length > 3 && d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return "jpeg";
  if (d.length > 2 && d[0] === 0x42 && d[1] === 0x4d) return "bmp";
  return null;
}

type Recognizer = {
  recognize(image: Buffer): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
};

async function createRecognizer(opts: OcrOptions, onPercent: (p: number) => void): Promise<Recognizer> {
  const langs = parseOcrLangs(opts.langs);
  const { createWorker } = await import("tesseract.js");
  try {
    return await createWorker(langs, 1, {
      langPath: opts.langPath,
      gzip: true,
      cacheMethod: "none", // 语言包已在本地，不再另存缓存
      logger: (m) => {
        if (m.status === "recognizing text") onPercent(Math.round(m.progress * 100));
      },
    });
  } catch (e) {
    throw new AppError("ocr.engineFailed", `OCR 引擎启动失败：${e instanceof Error ? e.message : String(e)}`, {
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

/** 进度只增不重复：同一页内百分比必须比上次发出的更大（引擎自己也会报 100%） */
function progressEmitter(cb: OcrOptions["onProgress"]) {
  let lastPage = 0;
  let lastPercent = -1;
  return (p: OcrProgress) => {
    if (!cb) return;
    if (p.page !== lastPage) {
      lastPage = p.page;
      lastPercent = -1;
    }
    if (p.percent <= lastPercent) return;
    lastPercent = p.percent;
    cb(p);
  };
}

const cancelled = () => new AppError("ocr.cancelled", "已取消文字识别", {});
const clean = (s: string) => s.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
const nonSpace = (s: string) => s.replace(/\s/g, "").length;

function finish(kind: "pdf" | "image", pages: string[], conf: number[]): OcrResult {
  const text = pages.join("\n\n").trim();
  const chars = nonSpace(text);
  if (chars === 0) throw new AppError("ocr.noText", "没有识别出任何文字，请确认图像清晰、方向正确", {});
  const confidence = conf.length ? Math.round((conf.reduce((a, b) => a + b, 0) / conf.length) * 10) / 10 : 0;
  return { kind, pages, text, chars, needsOcr: false, confidence, pageConfidence: conf };
}

/** 识别单张图片（PNG / JPEG / BMP） */
export async function ocrImage(data: Uint8Array, opts: OcrOptions): Promise<OcrResult> {
  if (!detectImageKind(data)) throw new AppError("doc.unsupported", "不支持的图片格式（仅支持 PNG、JPEG、BMP）", {});
  if (opts.signal?.aborted) throw cancelled();
  const emit = progressEmitter(opts.onProgress);
  const worker = await createRecognizer(opts, (percent) => emit({ page: 1, pages: 1, percent }));
  try {
    const r = await worker.recognize(Buffer.from(data));
    emit({ page: 1, pages: 1, percent: 100 });
    return finish("image", [clean(r.data.text)], [r.data.confidence]);
  } finally {
    await worker.terminate();
  }
}

/** 把 PDF 每页渲染成图片后逐页识别（用于没有文字层的扫描件） */
export async function ocrPdf(data: Uint8Array, opts: OcrOptions): Promise<OcrResult> {
  const [{ createCanvas }, pdfjs] = await Promise.all([import("@napi-rs/canvas"), import("pdfjs-dist/legacy/build/pdf.mjs")]);
  const task = pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: false, verbosity: 0 });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    await task.destroy().catch(() => undefined);
    if ((e as { name?: string })?.name === "PasswordException") throw new AppError("doc.pdfEncrypted", "PDF 已加密，无法读取");
    throw new AppError("doc.pdfInvalid", "无法解析该 PDF 文件");
  }

  let worker: Recognizer | undefined;
  try {
    const pages = doc.numPages;
    if (pages > MAX_PAGES) throw new AppError("ocr.tooManyPages", `扫描件页数过多（${pages} 页，上限 ${MAX_PAGES}）`, { pages, max: MAX_PAGES });

    let current = 1;
    const emit = progressEmitter(opts.onProgress);
    worker = await createRecognizer(opts, (percent) => emit({ page: current, pages, percent }));

    const texts: string[] = [];
    const conf: number[] = [];
    for (let n = 1; n <= pages; n++) {
      if (opts.signal?.aborted) throw cancelled();
      current = n;
      emit({ page: n, pages, percent: 0 });

      const page = await doc.getPage(n);
      let scale = opts.scale ?? DEFAULT_SCALE;
      let viewport = page.getViewport({ scale });
      // 超大页面（如大幅面图纸）按像素总量压低倍率，避免内存暴涨
      const pixels = viewport.width * viewport.height;
      if (pixels > MAX_PIXELS) {
        scale *= Math.sqrt(MAX_PIXELS / pixels);
        viewport = page.getViewport({ scale });
      }
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // pdfjs 的类型面向浏览器 DOM，@napi-rs/canvas 在运行时是兼容的
      await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
      const png = canvas.toBuffer("image/png");
      page.cleanup();

      const r = await worker.recognize(png);
      texts.push(clean(r.data.text));
      conf.push(r.data.confidence);
      emit({ page: n, pages, percent: 100 });
    }
    return finish("pdf", texts, conf);
  } finally {
    await worker?.terminate();
    await task.destroy();
  }
}
