import { formatLocalTime, isCustomRuleId, isLcStageRule, localizeFinding, ruleTitle, type Finding, type Lang, type LetterOfCredit, type Presentation, type Severity } from "@lc/core";
import type { RunRecord } from "@lc/storage";
import { REPORT_STRINGS, type ReportStrings } from "./strings";

export interface ReportFinding {
  severity: Severity;
  severityLabel: string;
  message: string;
  basis: string;
  evidence: { source: string; field: string; value: string }[];
  suggestion?: string;
}

export interface ReportActionGroup {
  title: string;
  items: { severity: Severity; severityLabel: string; text: string }[];
}

export interface Report {
  lang: Lang;
  s: ReportStrings;
  title: string;
  subtitle: string;
  meta: [string, string][];
  summary: {
    tone: "bad" | "warn" | "ok";
    headline: string;
    coverageLine: string | null;
    counts: { severity: Severity; label: string; count: number }[];
  };
  lcFacts: [string, string][];
  /** 本次审查所用的单据数据；未录入时为 null */
  presentation: { title: string; rows: [string, string][] }[] | null;
  lcFindings: ReportFinding[];
  docFindings: ReportFinding[];
  actions: ReportActionGroup[];
  coverage: { title: string; status: "passed" | "issues" | "skipped"; label: string }[];
  errors: { rule: string; message: string }[];
  disclaimer: string[];
}

export interface ReportInput {
  caseName: string;
  lc: LetterOfCredit;
  run: RunRecord;
  /** ISO 时间，报告生成时刻 */
  generatedAt: string;
  lang: Lang;
}

const fill = (tpl: string, params: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
const fmtTime = formatLocalTime;
const SEVERITIES: Severity[] = ["discrepancy", "risk", "doubt", "info"];

type ActionGroup = keyof ReportStrings["actionGroups"];

/**
 * 修改清单按「要改哪里」分组：
 * 信用证类问题与无法靠改单据解决的问题（迟装、过期）→ 与申请人沟通；发票/运输/保险 → 对应单据。
 */
export function actionGroupOf(f: Finding): ActionGroup {
  if (f.code.startsWith("custom.")) {
    // 自定义检查项：按它针对的对象归组；针对信用证的归入「信用证 / 与申请人沟通」
    const scope = f.params.scope;
    return scope === "invoice" || scope === "transport" || scope === "insurance" ? scope : "lc";
  }
  if (f.code.startsWith("lc.") || f.code === "shipment.late" || f.code === "presentation.expired") return "lc";
  if (f.code.startsWith("presentation.")) return "timing";
  if (f.code.startsWith("invoice.")) return "invoice";
  if (f.code.startsWith("transport.") || f.code.startsWith("carrierBl.")) return "transport";
  if (f.code.startsWith("insurance.")) return "insurance";
  return "lc";
}

/** 自定义检查项的 clause 形如 "Custom: 手册名"；去掉前缀只留出处，手工添加的写成人话 */
function customSource(clause: string, s: ReportStrings): string {
  const src = clause.replace(/^Custom: /, "");
  return src === "user-defined" ? s.userDefined : src;
}

function toReportFinding(f: Finding, s: ReportStrings, lang: Lang): ReportFinding {
  const text = localizeFinding(f, lang);
  return {
    severity: f.severity,
    severityLabel: s.severity[f.severity],
    message: text.message,
    basis: isCustomRuleId(f.ruleId) ? fill(s.basisCustom, { source: customSource(f.clause, s) }) : fill(s.basis, { clause: f.clause, ruleId: f.ruleId }),
    evidence: f.evidence.map((e) => ({ source: s.documents[e.document], field: e.field, value: e.value })),
    suggestion: text.suggestion,
  };
}

function lcFacts(lc: LetterOfCredit, s: ReportStrings, lang: Lang): [string, string][] {
  const f = s.facts;
  const rows: [string, string | undefined][] = [
    [f.reference, lc.reference],
    [f.form, lc.form],
    [f.issueDate, lc.issueDate],
    [f.amount, `${lc.currency} ${lc.amount.toLocaleString(lang === "zh" ? "zh-CN" : "en-US", { minimumFractionDigits: 2 })}`],
    [f.tolerance, lc.tolerance ? `+${lc.tolerance.plus}% / -${lc.tolerance.minus}%` : undefined],
    [f.expiry, [lc.expiryDate, lc.expiryPlace].filter(Boolean).join(" ") || undefined],
    [f.latestShipment, lc.latestShipmentDate],
    [f.presentationPeriod, lc.presentationDays ? fill(f.days, { n: lc.presentationDays }) : f.defaultDays],
    [f.applicant, lc.applicant],
    [f.beneficiary, lc.beneficiary],
    [f.portOfLoading, lc.portOfLoading],
    [f.portOfDischarge, lc.portOfDischarge],
    [f.partial, lc.partialShipments],
    [f.transhipment, lc.transhipment],
    [f.goods, lc.goodsDescription],
    [f.documents, lc.documentsRequired],
    [f.conditions, lc.additionalConditions],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

function presentationFacts(p: Presentation | null, s: ReportStrings): Report["presentation"] {
  if (!p) return null;
  const f = s.facts;
  const money = (c?: string, a?: number) => (a === undefined ? undefined : `${c ?? ""} ${a.toLocaleString("en-US", { minimumFractionDigits: 2 })}`.trim());
  const groups: { title: string; rows: [string, string | undefined][] }[] = [
    { title: s.docGroups.general, rows: [[f.presentationDate, p.presentationDate]] },
    {
      title: s.docGroups.invoice,
      rows: [
        [f.sellerName, p.invoice?.sellerName],
        [f.buyerName, p.invoice?.buyerName],
        [f.goodsDescription, p.invoice?.goodsDescription],
        [f.invoiceAmount, money(p.invoice?.currency, p.invoice?.amount) ?? p.invoice?.currency],
      ],
    },
    {
      title: s.docGroups.transport,
      rows: [
        [f.shipmentDate, p.transport?.shipmentDate],
        [f.portOfLoading, p.transport?.portOfLoading],
        [f.portOfDischarge, p.transport?.portOfDischarge],
        [f.issuerName, p.transport?.issuerName],
        [f.signingCapacity, p.transport?.signingCapacity],
      ],
    },
    {
      title: s.docGroups.insurance,
      rows: [
        [f.insuredAmount, money(p.insurance?.currency, p.insurance?.amount) ?? p.insurance?.currency],
        [f.insuranceDate, p.insurance?.date],
      ],
    },
  ];
  return groups
    .map((g) => ({ title: g.title, rows: g.rows.filter((r): r is [string, string] => !!r[1]) }))
    .filter((g) => g.rows.length > 0);
}

/** 由一次审查结果生成与排版无关的报告内容；PDF（HTML）与 Word 共用，保证两种格式内容一致 */
export function buildReport(input: ReportInput): Report {
  const { lc, run, lang } = input;
  const s = REPORT_STRINGS[lang];
  const count = (sev: Severity) => run.findings.filter((f) => f.severity === sev).length;
  const nBad = count("discrepancy");
  const nRisk = count("risk");
  const nDoubt = count("doubt");
  const isLcFinding = (f: Finding) => (f.stage ? f.stage === "lc" : isLcStageRule(run.coverage, f.ruleId));
  const docsChecked = run.coverage.checked.some((id) => !isLcStageRule(run.coverage, id));

  const parts: string[] = [];
  let tone: Report["summary"]["tone"];
  if (nBad > 0) {
    tone = "bad";
    parts.push(fill(s.headline.discrepancies, { n: nBad }));
  } else if (nRisk > 0) {
    tone = "warn";
    parts.push(fill(s.headline.risks, { n: nRisk }));
  } else if (nDoubt > 0) {
    tone = "warn";
    parts.push(fill(s.headline.doubts, { n: nDoubt }));
  } else {
    tone = "ok";
    parts.push(s.headline.clean);
  }
  if (!docsChecked) parts.push(s.headline.noPresentation);

  const hasCoverage = run.coverage.checked.length + run.coverage.skipped.length > 0;
  const groups = new Map<ActionGroup, ReportActionGroup>();
  for (const f of run.findings) {
    // 提示类不需要改动；但「人工核对」本身就是待办事项，必须进清单
    if (f.severity === "info" && f.code !== "custom.manual") continue;
    const key = actionGroupOf(f);
    const g = groups.get(key) ?? { title: s.actionGroups[key], items: [] };
    const t = localizeFinding(f, lang);
    g.items.push({ severity: f.severity, severityLabel: s.severity[f.severity], text: t.suggestion ? `${t.message} — ${t.suggestion}` : t.message });
    groups.set(key, g);
  }
  const ORDER: ActionGroup[] = ["lc", "timing", "invoice", "transport", "insurance"];

  return {
    lang,
    s,
    title: s.title,
    subtitle: s.subtitle,
    meta: [
      [s.meta.case, input.caseName],
      [s.meta.lc, lc.reference],
      [s.meta.checkedAt, fmtTime(run.at)],
      [s.meta.generated, fmtTime(input.generatedAt)],
      [s.meta.ruleset, run.rulesetVersion],
    ],
    summary: {
      tone,
      headline: parts.join(" "),
      coverageLine: hasCoverage ? fill(s.coverageLine, { checked: run.coverage.checked.length, skipped: run.coverage.skipped.length }) : null,
      counts: SEVERITIES.map((severity) => ({ severity, label: s.severity[severity], count: count(severity) })),
    },
    lcFacts: lcFacts(lc, s, lang),
    presentation: presentationFacts(run.presentation, s),
    lcFindings: run.findings.filter(isLcFinding).map((f) => toReportFinding(f, s, lang)),
    docFindings: run.findings.filter((f) => !isLcFinding(f)).map((f) => toReportFinding(f, s, lang)),
    actions: ORDER.filter((k) => groups.has(k)).map((k) => groups.get(k)!),
    coverage: [...run.coverage.checked, ...run.coverage.skipped].map((id) => {
      const skipped = run.coverage.skipped.includes(id);
      const n = run.findings.filter((f) => f.ruleId === id).length;
      const status = skipped ? "skipped" : n > 0 ? "issues" : "passed";
      return { title: ruleTitle(id, lang, run.customTitles), status, label: status === "issues" ? fill(s.coverageStatus.issues, { n }) : s.coverageStatus[status] };
    }),
    errors: run.errors.map((e) => ({ rule: ruleTitle(e.ruleId, lang, run.customTitles), message: e.message })),
    disclaimer: s.disclaimer,
  };
}
