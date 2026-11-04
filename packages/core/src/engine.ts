import type { Finding, LetterOfCredit, PresentedText, Presentation, Rule } from "./model";

export interface RunResult {
  findings: Finding[];
  /** 规则自身抛错时记录，避免静默漏报 */
  errors: { ruleId: string; message: string }[];
  /**
   * 覆盖情况：已执行的规则，以及因缺少数据/单据而未检查的规则。
   * lcRules：属于审证（只看信用证本身）的规则 ID，用于把结果分成审证/审单两部分（旧记录没有该字段）。
   */
  coverage: { checked: string[]; skipped: string[]; lcRules?: string[] };
}

const ORDER = { discrepancy: 0, risk: 1, doubt: 2, info: 3 } as const;

/** 该规则 ID 是否属于审证。旧记录没有 lcRules 时退回按内置规则的 LCR- 前缀判断 */
export const isLcStageRule = (coverage: RunResult["coverage"], ruleId: string): boolean =>
  coverage.lcRules ? coverage.lcRules.includes(ruleId) : ruleId.startsWith("LCR-");

/**
 * 执行规则。
 * - 审证规则（lc）：只看信用证，随时可运行
 * - 单据文字规则（documents）：需要至少导入一份单据
 * - 审单规则（presentation）：需要交单数据；缺省时记为「未检查」
 * 单条规则抛错不影响其余规则，错误单独返回。
 */
export function runRules(
  rules: Rule[],
  input: { lc: LetterOfCredit; presentation?: Presentation | null; documents?: PresentedText[] },
): RunResult {
  const { lc, presentation } = input;
  const documents = input.documents ?? [];
  const findings: Finding[] = [];
  const errors: RunResult["errors"] = [];
  const coverage: RunResult["coverage"] = { checked: [], skipped: [], lcRules: [] };

  // 规则可以自己指定发现属于审证还是审单（如不依赖数据、但针对某份单据的人工提醒），否则按规则类型
  const push = (list: Finding[], stage: "lc" | "docs") => findings.push(...list.map((f) => ({ ...f, stage: f.stage ?? stage })));

  for (const rule of rules) {
    try {
      if (rule.stage === "lc") {
        coverage.lcRules!.push(rule.id);
        push(rule.evaluate({ lc }), "lc");
      } else if (rule.stage === "documents") {
        const ctx = { lc, documents };
        if (documents.length === 0 || (rule.applicable && !rule.applicable(ctx))) {
          coverage.skipped.push(rule.id);
          continue;
        }
        push(rule.evaluate(ctx), "docs");
      } else {
        if (!presentation) {
          coverage.skipped.push(rule.id);
          continue;
        }
        const ctx = { lc, presentation, documents };
        if (rule.applicable && !rule.applicable(ctx)) {
          coverage.skipped.push(rule.id);
          continue;
        }
        push(rule.evaluate(ctx), "docs");
      }
      coverage.checked.push(rule.id);
    } catch (e) {
      errors.push({ ruleId: rule.id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  findings.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return { findings, errors, coverage };
}
