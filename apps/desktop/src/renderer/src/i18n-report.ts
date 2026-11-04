/** 报告导出相关文案 */
export const zhReport: Record<string, string> = {
  "report.exportPdf": "导出 PDF",
  "report.exportWord": "导出 Word",
  "report.exporting": "正在生成报告…",
  "report.saved": "报告已保存",
  "report.open": "打开所在文件夹",
  "report.hint": "报告以当前界面语言生成，内容为这次审查的结果和当时使用的单据数据。",
  "err.report.noRun": "尚未审查，无法导出报告",
  "err.report.pdfFailed": "生成 PDF 失败：{detail}",
  "err.report.writeFailed": "保存失败：{detail}",
};

export const enReport: Record<string, string> = {
  "report.exportPdf": "Export PDF",
  "report.exportWord": "Export Word",
  "report.exporting": "Generating the report…",
  "report.saved": "Report saved",
  "report.open": "Show in folder",
  "report.hint": "The report is generated in the current interface language and contains this check's results and the document data used for it.",
  "err.report.noRun": "Nothing has been checked yet, so there is no report to export",
  "err.report.pdfFailed": "Failed to generate the PDF: {detail}",
  "err.report.writeFailed": "Failed to save: {detail}",
};
