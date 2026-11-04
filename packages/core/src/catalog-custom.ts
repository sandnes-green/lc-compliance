/**
 * 自定义检查项（手册提炼）的文案。{title}、{requirement}、{file}、{phrases}、{detail} 都来自用户数据或模型输出，
 * 不做翻译；占位符取自 Finding.params。
 */
type Entry = Record<"zh" | "en", { message: string; suggestion?: string }>;

export const CUSTOM_CATALOG: Record<string, Entry> = {
  "custom.text.missing": {
    zh: { message: "{file} 不满足检查项「{title}」：缺少 {phrases}", suggestion: "要求：{requirement}。请修改单据后重新导入。" },
    en: { message: "{file} does not meet check item “{title}”: missing {phrases}", suggestion: "Requirement: {requirement}. Correct the document and import it again." },
  },
  "custom.text.missingAny": {
    zh: { message: "{file} 不满足检查项「{title}」：以下词语至少应出现一个：{phrases}", suggestion: "要求：{requirement}。请修改单据后重新导入。" },
    en: { message: "{file} does not meet check item “{title}”: at least one of these should appear: {phrases}", suggestion: "Requirement: {requirement}. Correct the document and import it again." },
  },
  "custom.text.forbidden": {
    zh: { message: "{file} 不满足检查项「{title}」：出现了不允许的词语 {phrases}", suggestion: "要求：{requirement}。请修改单据后重新导入。" },
    en: { message: "{file} does not meet check item “{title}”: contains wording that is not allowed: {phrases}", suggestion: "Requirement: {requirement}. Correct the document and import it again." },
  },
  "custom.manual": {
    zh: { message: "人工核对：{title}", suggestion: "{requirement}" },
    en: { message: "Check manually: {title}", suggestion: "{requirement}" },
  },
  "custom.ai.notMet": {
    zh: { message: "AI 认为 {file} 可能不满足检查项「{title}」（AI 判断不确定，需人工确认）{detail}", suggestion: "要求：{requirement}" },
    en: { message: "AI thinks {file} may not meet check item “{title}” (an AI judgement is not definitive; please confirm manually){detail}", suggestion: "Requirement: {requirement}" },
  },
  "custom.ai.unclear": {
    zh: { message: "AI 无法判断 {file} 是否满足检查项「{title}」，请人工核对{detail}", suggestion: "要求：{requirement}" },
    en: { message: "AI could not tell whether {file} meets check item “{title}”; please check manually{detail}", suggestion: "Requirement: {requirement}" },
  },
};
