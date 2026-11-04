/**
 * 发送给外部模型前的可选脱敏：遮蔽账号、IBAN、邮箱、电话。
 * 不处理公司名、货描、金额与日期——这些是审单所需信息。
 */
const PATTERNS: [RegExp, string][] = [
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, "[IBAN]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[EMAIL]"],
  [/(?<![\d.,])\d{12,19}(?![\d.,])/g, "[ACCOUNT]"],
  [/(?<![\d.,])\+?\d[\d -]{8,}\d(?![\d.,])/g, "[PHONE]"],
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function redact(text: string): string {
  return PATTERNS.reduce(
    // 日期形如 2024-08-12 会被电话规则误伤，原样保留
    (t, [re, label]) => t.replace(re, (m) => (ISO_DATE.test(m) ? m : label)),
    text,
  );
}
