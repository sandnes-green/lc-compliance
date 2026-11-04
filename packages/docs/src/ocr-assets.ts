import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError } from "@lc/core";
import { parseOcrLangs } from "./ocr";

/** 语言包版本目录：tessdata_best 的整数量化版，识别率高、体积小 */
const DATA_VARIANT = "4.0.0_best_int";

/**
 * 准备 OCR 语言包目录：把随应用安装的 @tesseract.js-data/<lang> 里的语言文件
 * 汇集到同一个目录（tesseract.js 只接受单个 langPath）。已存在则跳过，因此只会复制一次。
 *
 * @param anchorDir 用来解析 node_modules 的目录（开发时为应用目录；打包后需指向资源目录）
 */
export function prepareLangDir(destDir: string, langs: string, anchorDir: string, resolve: (id: string, from: string) => string): string {
  mkdirSync(destDir, { recursive: true });
  for (const lang of parseOcrLangs(langs)) {
    const target = join(destDir, `${lang}.traineddata.gz`);
    if (existsSync(target)) continue;
    let source: string;
    try {
      source = join(dirname(resolve(`@tesseract.js-data/${lang}/package.json`, anchorDir)), DATA_VARIANT, `${lang}.traineddata.gz`);
    } catch {
      throw new AppError("ocr.langMissing", `缺少 OCR 语言包：${lang}`, { lang });
    }
    if (!existsSync(source)) throw new AppError("ocr.langMissing", `缺少 OCR 语言包：${lang}`, { lang });
    copyFileSync(source, target);
  }
  return destDir;
}
