export * from "./model";
export * from "./html";
export * from "./docx";
export { REPORT_STRINGS } from "./strings";

/** 导出文件名：案件名中不适合做文件名的字符替换为下划线 */
export function reportFileName(caseName: string, lang: "zh" | "en", date: string, ext: "pdf" | "docx"): string {
  const safe = caseName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/, "").slice(0, 60) || "case";
  return `${safe}-${lang === "zh" ? "审单报告" : "check-report"}-${date.slice(0, 10)}.${ext}`;
}
