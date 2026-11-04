import { parseOcrLangs } from "@lc/docs";
import type { CaseStore } from "@lc/storage";

export const OCR_LANGS_KEY = "ocr.langs";
export const DEFAULT_OCR_LANGS = "eng";

/** 可选的识别语言组合（中文单据多见中英混排，但混合识别更慢、英文准确率略降，故默认只用英文） */
export const OCR_LANG_CHOICES = ["eng", "eng+chi_sim"] as const;

export function getOcrLangs(store: CaseStore): string {
  const saved = store.getSetting(OCR_LANGS_KEY);
  if (!saved) return DEFAULT_OCR_LANGS;
  try {
    return parseOcrLangs(saved).join("+");
  } catch {
    return DEFAULT_OCR_LANGS; // 库里的值被改坏时回退，而不是让所有 OCR 失败
  }
}

/** 保存识别语言；非白名单语言抛出 ocr.langUnsupported。返回规范化后的值 */
export function saveOcrLangs(store: CaseStore, langs: string): string {
  const normalized = parseOcrLangs(langs).join("+");
  store.setSetting(OCR_LANGS_KEY, normalized);
  store.logEvent("settings.ocr", { langs: normalized });
  return normalized;
}
