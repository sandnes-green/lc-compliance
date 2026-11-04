import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { Severity } from "@lc/core";
import type { Report, ReportFinding } from "./model";

const SEV_COLOR: Record<Severity, string> = { discrepancy: "A8071A", risk: "AD4E00", doubt: "AD6800", info: "0958D9" };
const TONE: Record<Report["summary"]["tone"], { fg: string; bg: string }> = {
  bad: { fg: "A8071A", bg: "FFF1F0" },
  warn: { fg: "AD4E00", bg: "FFF7E6" },
  ok: { fg: "135200", bg: "F6FFED" },
};
const STATUS_COLOR = { passed: "389E0D", issues: "D46B08", skipped: "8C8C8C" } as const;
const LINE = { style: BorderStyle.SINGLE, size: 4, color: "D9D9D9" };
const TABLE_BORDERS = { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE };

/** 多行文本 → 带换行的 TextRun（Word 里 "\n" 不会自动换行） */
function runs(text: string, opts: { bold?: boolean; color?: string; size?: number } = {}): TextRun[] {
  return text.split("\n").map((line, i) => new TextRun({ text: line, break: i === 0 ? 0 : 1, bold: opts.bold, color: opts.color, size: opts.size }));
}

const para = (text: string, opts: { bold?: boolean; color?: string; size?: number; after?: number } = {}) =>
  new Paragraph({ children: runs(text, opts), spacing: { after: opts.after ?? 80 } });

const h1 = (text: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true })], spacing: { before: 280, after: 100 } });

function cell(children: Paragraph[], widthPct: number, fill?: string): TableCell {
  return new TableCell({
    width: { size: widthPct, type: WidthType.PERCENTAGE },
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
    children,
  });
}

function table(widths: number[], rows: { cells: Paragraph[][]; header?: boolean }[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: TABLE_BORDERS,
    rows: rows.map((r) => new TableRow({ tableHeader: r.header, cantSplit: true, children: r.cells.map((c, i) => cell(c, widths[i]!, r.header ? "FAFAFA" : undefined)) })),
  });
}

const kv = (rows: [string, string][]) => table([28, 72], rows.map(([k, v]) => ({ cells: [[para(k, { bold: true, after: 0 })], [para(v, { after: 0 })]] })));

function finding(f: ReportFinding, r: Report): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: { before: 140, after: 40 },
      keepNext: true,
      children: [new TextRun({ text: `[${f.severityLabel}] `, bold: true, color: SEV_COLOR[f.severity] }), ...runs(f.message, { bold: true })],
    }),
    para(f.basis, { color: "595959", size: 19, after: 40 }),
  ];
  if (f.evidence.length) {
    out.push(
      table(
        [20, 25, 55],
        [
          { header: true, cells: [[para(r.s.evidenceCols.source, { bold: true, size: 19, after: 0 })], [para(r.s.evidenceCols.field, { bold: true, size: 19, after: 0 })], [para(r.s.evidenceCols.value, { bold: true, size: 19, after: 0 })]] },
          ...f.evidence.map((e) => ({ cells: [[para(e.source, { size: 19, after: 0 })], [para(e.field, { size: 19, after: 0 })], [para(e.value, { size: 19, after: 0 })]] })),
        ],
      ),
    );
  }
  if (f.suggestion) {
    out.push(
      new Paragraph({
        spacing: { before: 60, after: 60 },
        shading: { type: ShadingType.CLEAR, fill: "F0F5FF", color: "auto" },
        children: [new TextRun({ text: `${r.s.suggestion}${r.lang === "zh" ? "：" : ": "}`, bold: true }), ...runs(f.suggestion)],
      }),
    );
  }
  return out;
}

/** 生成 Word (.docx) 文档，内容与 PDF 报告一致，可继续编辑 */
export async function renderReportDocx(r: Report): Promise<Uint8Array> {
  const tone = TONE[r.summary.tone];
  const children: (Paragraph | Table)[] = [];

  children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: r.title, bold: true })] }));
  children.push(para(r.subtitle, { color: "595959", after: 120 }));
  children.push(kv(r.meta));

  children.push(h1(r.s.sections.summary));
  children.push(new Paragraph({ spacing: { after: 80 }, shading: { type: ShadingType.CLEAR, fill: tone.bg, color: "auto" }, children: runs(r.summary.headline, { bold: true, color: tone.fg }) }));
  children.push(
    new Paragraph({
      spacing: { after: 80 },
      children: r.summary.counts.flatMap((c) => [new TextRun({ text: `${c.label} ${c.count}`, bold: true, color: SEV_COLOR[c.severity] }), new TextRun({ text: "    " })]),
    }),
  );
  if (r.summary.coverageLine) children.push(para(r.summary.coverageLine));

  children.push(h1(r.s.sections.lcFacts));
  children.push(kv(r.lcFacts));

  children.push(h1(r.s.sections.presentation));
  if (r.presentation) {
    for (const g of r.presentation) {
      children.push(para(g.title, { bold: true, after: 40 }));
      children.push(kv(g.rows));
      children.push(para("", { after: 40 }));
    }
  } else {
    children.push(para(r.s.noPresentationData));
  }

  const section = (title: string, list: ReportFinding[]) => {
    children.push(h1(title));
    if (list.length === 0) children.push(para(r.s.sectionClean, { color: "135200" }));
    for (const f of list) children.push(...finding(f, r));
  };
  section(r.s.sections.lcFindings, r.lcFindings);
  section(r.s.sections.docFindings, r.docFindings);

  children.push(h1(r.s.sections.actions));
  if (r.actions.length === 0) children.push(para(r.s.actionsEmpty));
  for (const g of r.actions) {
    children.push(new Paragraph({ keepNext: true, spacing: { before: 120, after: 40 }, children: [new TextRun({ text: g.title, bold: true })] }));
    for (const i of g.items) {
      children.push(
        new Paragraph({
          spacing: { after: 40 },
          indent: { left: 360, hanging: 360 },
          children: [new TextRun({ text: "☐  " }), new TextRun({ text: `[${i.severityLabel}] `, bold: true, color: SEV_COLOR[i.severity] }), ...runs(i.text)],
        }),
      );
    }
  }

  children.push(h1(r.s.sections.coverage));
  children.push(table([55, 45], r.coverage.map((c) => ({ cells: [[para(c.title, { after: 0 })], [para(c.label, { color: STATUS_COLOR[c.status], after: 0 })]] }))));
  if (r.errors.length) {
    children.push(para(r.s.sections.errors, { bold: true, after: 40 }));
    for (const e of r.errors) children.push(para(`${e.rule}: ${e.message}`));
  }

  children.push(h1(r.s.sections.disclaimer));
  for (const d of r.disclaimer) children.push(para(d, { color: "595959", size: 19 }));

  const doc = new Document({
    title: r.title,
    creator: r.title,
    styles: {
      default: { document: { run: { font: { ascii: "Calibri", hAnsi: "Calibri", eastAsia: "Microsoft YaHei" }, size: 21 } } },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES], color: "8C8C8C", size: 18 })] })],
          }),
        },
        children,
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
