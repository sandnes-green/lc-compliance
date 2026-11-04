import { ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Language, Result } from "../../shared/api";
import { DICTS, fill, type Dict } from "./i18n-dicts";

export type Translate = (key: string, params?: Record<string, string | number>) => string;

interface I18n {
  lang: Language;
  t: Translate;
  setLang(l: Language): void;
  /** 把 IPC 失败结果转成当前语言的提示；无对应译文时回退到原始消息 */
  errorText(r: Extract<Result<unknown>, { ok: false }>): string;
}

const Ctx = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n 必须在 I18nProvider 内使用");
  return v;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>("zh");

  useEffect(() => {
    void window.lc.getLanguage().then((r) => r.ok && setLangState(r.data));
    return window.lc.onLanguageChanged(setLangState);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = DICTS[lang]["app.title"]!;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    const t: Translate = (key, params) => fill(dict[key] ?? key, params);
    return {
      lang,
      t,
      setLang: (l) => void window.lc.setLanguage(l),
      errorText: (r) => {
        // 优先用「错误码.出错字段」的专用文案（如检查项校验失败时指出具体哪一项）
        const field = r.params?.field;
        const specific = r.code && typeof field === "string" ? `err.${r.code}.${field}` : "";
        const k = specific && dict[specific] ? specific : r.code ? `err.${r.code}` : "";
        return k && dict[k] ? fill(dict[k]!, r.params) : r.error;
      },
    };
  }, [lang]);

  return (
    <Ctx.Provider value={value}>
      <ConfigProvider locale={lang === "zh" ? zhCN : enUS}>{children}</ConfigProvider>
    </Ctx.Provider>
  );
}
