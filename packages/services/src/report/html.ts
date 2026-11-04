import type { Severity } from "@lc/core";
import type { Report, ReportFinding } from "./model";

/** 报告里的文字来自信用证、单据、OCR/AI 结果，都不可信，一律转义后再放进 HTML */
export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** 保留换行 */
const multiline = (s: string) => esc(s).replace(/\n/g, "<br>");

const SEV_COLOR: Record<Severity, { fg: string; bg: string }> = {
  discrepancy: { fg: "#a8071a", bg: "#fff1f0" },
  risk: { fg: "#ad4e00", bg: "#fff2e8" },
  doubt: { fg: "#ad6800", bg: "#fffbe6" },
  info: { fg: "#0958d9", bg: "#e6f4ff" },
};
const TONE: Record<Report["summary"]["tone"], { fg: string; bg: string; border: string }> = {
  bad: { fg: "#a8071a", bg: "#fff1f0", border: "#ffa39e" },
  warn: { fg: "#ad4e00", bg: "#fff7e6", border: "#ffd591" },
  ok: { fg: "#135200", bg: "#f6ffed", border: "#b7eb8f" },
};

const CSS = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Microsoft YaHei", "Segoe UI", "PingFang SC", Arial, sans-serif; font-size: 10.5pt; color: #1f1f1f; line-height: 1.55; margin: 0; }
h1 { font-size: 20pt; margin: 0 0 2pt; }
.sub { color: #595959; margin: 0 0 10pt; }
h2 { font-size: 13pt; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5px solid #d9d9d9; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0; }
th, td { border: 1px solid #d9d9d9; padding: 4pt 7pt; text-align: left; vertical-align: top; }
th { background: #fafafa; font-weight: 600; }
table.kv th { width: 28%; }
.meta td:first-child, .meta th { width: 22%; }
.summary { border: 1px solid; border-radius: 4px; padding: 8pt 10pt; margin: 4pt 0 6pt; font-weight: 600; }
.tags span, .tag { display: inline-block; border-radius: 3px; padding: 0 6pt; margin-right: 6pt; font-size: 9.5pt; font-weight: 600; }
.finding { border: 1px solid #d9d9d9; border-radius: 4px; padding: 7pt 9pt; margin: 6pt 0; page-break-inside: avoid; }
.finding .msg { font-weight: 600; }
.finding .basis { color: #595959; font-size: 9.5pt; margin: 3pt 0; }
.finding table { font-size: 9.5pt; }
.suggest { background: #f0f5ff; border-left: 3px solid #597ef7; padding: 4pt 8pt; margin-top: 5pt; }
.clean { color: #135200; background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 4px; padding: 5pt 9pt; }
.action-group { page-break-inside: avoid; margin-bottom: 6pt; }
.action-group h3 { font-size: 11pt; margin: 8pt 0 3pt; }
ul.todo { list-style: none; padding-left: 0; margin: 0; }
h3 { page-break-after: avoid; }
table.kv { page-break-inside: avoid; }
ul.todo li { position: relative; padding: 3pt 0 3pt 20pt; }
ul.todo li::before { content: ""; position: absolute; left: 1pt; top: 6pt; width: 9pt; height: 9pt; border: 1.2px solid #595959; border-radius: 2px; }
.status-passed { color: #389e0d; } .status-issues { color: #d46b08; } .status-skipped { color: #8c8c8c; }
.disclaimer { color: #595959; font-size: 9.5pt; }
`;

function kvTable(rows: [string, string][]): string {
  return `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${multiline(v)}</td></tr>`).join("")}</table>`;
}

function tag(label: string, sev: Severity): string {
  const c = SEV_COLOR[sev];
  return `<span class="tag" style="color:${c.fg};background:${c.bg}">${esc(label)}</span>`;
}

function finding(f: ReportFinding, r: Report): string {
  const ev = f.evidence.length
    ? `<table><tr><th>${esc(r.s.evidenceCols.source)}</th><th>${esc(r.s.evidenceCols.field)}</th><th>${esc(r.s.evidenceCols.value)}</th></tr>${f.evidence
        .map((e) => `<tr><td>${esc(e.source)}</td><td>${esc(e.field)}</td><td>${multiline(e.value)}</td></tr>`)
        .join("")}</table>`
    : "";
  const suggestion = f.suggestion ? `<div class="suggest"><b>${esc(r.s.suggestion)}${r.lang === "zh" ? "：" : ": "}</b>${esc(f.suggestion)}</div>` : "";
  return `<div class="finding"><div class="msg">${tag(f.severityLabel, f.severity)}${esc(f.message)}</div><div class="basis">${esc(f.basis)}</div>${ev}${suggestion}</div>`;
}

/** 生成可打印的完整 HTML 文档（用于导出 PDF） */
export function renderReportHtml(r: Report): string {
  const tone = TONE[r.summary.tone];
  const parts: string[] = [];

  parts.push(`<h1>${esc(r.title)}</h1><p class="sub">${esc(r.subtitle)}</p>`);
  parts.push(`<table class="kv meta">${r.meta.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`);

  parts.push(`<h2>${esc(r.s.sections.summary)}</h2>`);
  parts.push(`<div class="summary" style="color:${tone.fg};background:${tone.bg};border-color:${tone.border}">${esc(r.summary.headline)}</div>`);
  parts.push(`<div class="tags">${r.summary.counts.map((c) => `<span style="color:${SEV_COLOR[c.severity].fg};background:${SEV_COLOR[c.severity].bg}">${esc(c.label)} ${c.count}</span>`).join("")}</div>`);
  if (r.summary.coverageLine) parts.push(`<p>${esc(r.summary.coverageLine)}</p>`);

  parts.push(`<h2>${esc(r.s.sections.lcFacts)}</h2>${kvTable(r.lcFacts)}`);

  parts.push(`<h2>${esc(r.s.sections.presentation)}</h2>`);
  if (r.presentation) {
    for (const g of r.presentation) parts.push(`<h3 style="font-size:11pt;margin:8pt 0 2pt">${esc(g.title)}</h3>${kvTable(g.rows)}`);
  } else {
    parts.push(`<p>${esc(r.s.noPresentationData)}</p>`);
  }

  const section = (title: string, list: ReportFinding[]) => {
    parts.push(`<h2>${esc(title)}</h2>`);
    parts.push(list.length ? list.map((f) => finding(f, r)).join("") : `<div class="clean">${esc(r.s.sectionClean)}</div>`);
  };
  section(r.s.sections.lcFindings, r.lcFindings);
  section(r.s.sections.docFindings, r.docFindings);

  parts.push(`<h2>${esc(r.s.sections.actions)}</h2>`);
  if (r.actions.length === 0) parts.push(`<p>${esc(r.s.actionsEmpty)}</p>`);
  for (const g of r.actions) {
    parts.push(`<div class="action-group"><h3>${esc(g.title)}</h3><ul class="todo">${g.items.map((i) => `<li>${tag(i.severityLabel, i.severity)}${esc(i.text)}</li>`).join("")}</ul></div>`);
  }

  parts.push(`<h2>${esc(r.s.sections.coverage)}</h2>`);
  parts.push(`<table>${r.coverage.map((c) => `<tr><td>${esc(c.title)}</td><td class="status-${c.status}">${esc(c.label)}</td></tr>`).join("")}</table>`);
  if (r.errors.length) {
    parts.push(`<h3 style="font-size:11pt">${esc(r.s.sections.errors)}</h3><ul>${r.errors.map((e) => `<li>${esc(e.rule)}：${esc(e.message)}</li>`).join("")}</ul>`);
  }

  parts.push(`<h2>${esc(r.s.sections.disclaimer)}</h2><div class="disclaimer">${r.disclaimer.map((d) => `<p>${esc(d)}</p>`).join("")}</div>`);

  // 报告页面不需要脚本，也不应加载任何外部资源
  return `<!doctype html><html lang="${r.lang === "zh" ? "zh-CN" : "en"}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(r.title)}</title><style>${CSS}</style></head><body>${parts.join("\n")}</body></html>`;
}
