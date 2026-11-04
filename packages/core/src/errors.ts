/**
 * 带稳定编码的业务错误。message 为中文默认文案（便于日志与测试），
 * 界面应按 code + params 做本地化展示。
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(message);
  }
}
