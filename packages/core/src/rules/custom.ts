import { matchText, type CheckItem } from "../checks";
import { makeFinding } from "../messages";
import type { DocumentRule, Evidence, Finding, LcRule, Rule } from "../model";

export const CUSTOM_PREFIX = "CUSTOM-";
export const customRuleId = (itemId: string) => `${CUSTOM_PREFIX}${itemId}`;
export const isCustomRuleId = (ruleId: string) => ruleId.startsWith(CUSTOM_PREFIX);

/** 检查项的出处：用于条款依据与证据表，让每条发现都能追到手册原文 */
export const customClause = (item: CheckItem) => `Custom: ${item.source?.manualName ?? "user-defined"}`;

export function sourceEvidence(item: CheckItem): Evidence[] {
  return item.source ? [{ document: "manual", field: item.source.manualName, value: item.source.quote }] : [];
}

const LC_LABEL = "L/C";

function textFinding(item: CheckItem, file: string, missingOrFound: string[]): Finding {
  const m = item.textMatch!;
  const code = m.mode === "none" ? "custom.text.forbidden" : m.mode === "any" ? "custom.text.missingAny" : "custom.text.missing";
  return makeFinding({
    ruleId: customRuleId(item.id),
    clause: customClause(item),
    severity: item.severity,
    code,
    params: { title: item.title, requirement: item.requirement, file, phrases: missingOrFound.join(" ; "), scope: item.scope },
    evidence: [{ document: item.scope === "lc" ? "lc" : item.scope, field: file, value: missingOrFound.join(" ; ") }, ...sourceEvidence(item)],
  });
}

function textRule(item: CheckItem): LcRule | DocumentRule {
  const base = { id: customRuleId(item.id), clause: customClause(item), title: item.title };
  if (item.scope === "lc") {
    const rule: LcRule = {
      ...base,
      stage: "lc",
      evaluate({ lc }) {
        const r = matchText(Object.values(lc.raw).join("\n"), item.textMatch!);
        return r.ok ? [] : [textFinding(item, LC_LABEL, r.phrases)];
      },
    };
    return rule;
  }
  const rule: DocumentRule = {
    ...base,
    stage: "documents",
    applicable: ({ documents }) => documents.some((d) => d.docType === item.scope),
    evaluate({ documents }) {
      const out: Finding[] = [];
      for (const d of documents) {
        if (d.docType !== item.scope) continue;
        const r = matchText(d.text, item.textMatch!);
        if (!r.ok) out.push(textFinding(item, d.fileName, r.phrases));
      }
      return out;
    },
  };
  return rule;
}

function manualRule(item: CheckItem): LcRule {
  return {
    id: customRuleId(item.id),
    clause: customClause(item),
    title: item.title,
    stage: "lc", // 运行时机：不依赖任何数据，每次审查都出现（结果归属见 evaluate 里发现的 stage）
    evaluate: () => [
      {
        ...makeFinding({
          ruleId: customRuleId(item.id),
          clause: customClause(item),
          severity: item.severity,
          code: "custom.manual",
          params: { title: item.title, requirement: item.requirement, scope: item.scope },
          evidence: sourceEvidence(item),
        }),
        // 在结果里归到它所针对的对象：信用证 → 审证，单据 → 审单
        stage: item.scope === "lc" ? "lc" : "docs",
      },
    ],
  };
}

/**
 * 把已启用的「文字」「人工」检查项变成规则（确定性、同步执行）。
 * 「AI 判断」类需要联网调用模型，由服务层单独处理，不在这里。
 */
export function buildCustomRules(items: CheckItem[]): Rule[] {
  const rules: Rule[] = [];
  for (const item of items) {
    if (item.status !== "enabled") continue;
    if (item.kind === "text" && item.textMatch) rules.push(textRule(item));
    else if (item.kind === "manual") rules.push(manualRule(item));
  }
  return rules;
}
