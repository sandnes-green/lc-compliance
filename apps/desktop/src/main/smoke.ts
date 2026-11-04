import type { LlmClient } from "@lc/core";

/**
 * 冒烟自检专用：不联网的假模型，按真实模型应有的格式（含原文引用）返回，
 * 用来验证 单据抽取、手册提炼、AI 判断 三条链路的完整流程（脱敏、引用校验、入库、审查）。
 */
export const fakeLlm: LlmClient = {
  async completeJson(messages) {
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const user = messages.find((m) => m.role === "user")?.content ?? "";

    // 手册提炼
    if (system.includes("trade-finance document-checking manual")) {
      const items: Record<string, unknown>[] = [];
      for (const line of user.split("\n")) {
        const text = line.replace(/^\d+\.\s*/, "").replace(/[。]$/, "");
        if (line.includes("FREIGHT PREPAID")) {
          items.push({ title: "提单须注明运费预付", requirement: text, scope: "transport", kind: "text", severity: "discrepancy", mode: "all", phrases: ["FREIGHT PREPAID"], quote: text });
        } else if (line.includes("货物描述")) {
          items.push({ title: "发票货描无矛盾", requirement: text, scope: "invoice", kind: "ai", severity: "doubt", quote: text });
        } else if (line.includes("电话确认")) {
          items.push({ title: "发运前电话确认买方", requirement: text, scope: "invoice", kind: "manual", severity: "info", quote: text });
        }
      }
      return { items };
    }

    // AI 判断：对每条编号的要求都回答「不满足」
    if (system.includes("check whether a trade document")) {
      const n = (user.match(/^\d+\. /gm) ?? []).length;
      return { results: Array.from({ length: n }, (_, i) => ({ n: i + 1, verdict: "not_met", quote: "", reason: "smoke" })) };
    }

    // 单据字段抽取
    const m = /Total Amount:\s*([A-Z]{3})\s*([\d,]+\.\d{2})/.exec(user);
    const date = /Date:\s*(\d{4}-\d{2}-\d{2})/.exec(user);
    const fields: { name: string; value: string; quote: string }[] = [];
    if (m) {
      fields.push({ name: "currency", value: m[1]!, quote: m[0] });
      fields.push({ name: "amount", value: m[2]!.replace(/,/g, ""), quote: m[0] });
    }
    if (date) fields.push({ name: "date", value: date[1]!, quote: date[0] });
    return { fields };
  },
};
