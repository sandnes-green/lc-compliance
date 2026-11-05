import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { Presentation } from "@lc/core";
import { CaseStore } from "@lc/storage";
import { actionGroupOf, buildReport, esc, renderReportDocx, renderReportHtml, reportFileName } from "../src";

// 合成数据（非真实）：一份带多种问题的信用证与单据
const LC = [
  ":20:RPT-1", ":40A:IRREVOCABLE", ":31D:241030SHANGHAI", ":32B:USD100000,00", ":44C:241020",
  ":44E:SHANGHAI, CHINA", ":44F:NEW YORK", ":50:ACME IMPORTS INC", ":59:SANDNES TRADING CO LTD",
  ":45A:1000 SETS OF WIDGETS MODEL X", "CIF NEW YORK",
  ":47A:+INSPECTION CERTIFICATE SIGNED BY THE APPLICANT", ":48:21 DAYS",
].join("\n");

const BAD: Presentation = {
  presentationDate: "2024-10-25",
  invoice: { currency: "USD", amount: 100000, sellerName: "OTHER LTD", buyerName: "ACME IMPORTS INC", goodsDescription: "1000 SETS OF WIDGETS MODEL Y CIF NEW YORK" },
  transport: { shipmentDate: "2024-10-10", portOfLoading: "NINGBO", portOfDischarge: "NEW YORK" },
  insurance: { currency: "USD", amount: 100000, date: "2024-10-12" },
};

function make(lcText = LC, presentation?: Presentation) {
  const store = new CaseStore();
  const c = store.createCase({ name: "客户A / 2024年8月:出口", lcText });
  if (presentation) store.savePresentation(c.id, presentation);
  const run = store.runCase(c.id);
  return { c, run, input: (lang: "zh" | "en") => ({ caseName: c.name, lc: c.lc, run, generatedAt: "2026-11-04T08:30:00.000Z", lang }) };
}

describe("buildReport", () => {
  const { input } = make(LC, BAD);

  it("有不符点：结论为需修改，计数与分区正确", () => {
    const r = buildReport(input("zh"));
    expect(r.summary.tone).toBe("bad");
    expect(r.summary.headline).toContain("不符点");
    expect(r.summary.counts.find((c) => c.severity === "discrepancy")!.count).toBe(5);
    expect(r.lcFindings.length).toBeGreaterThan(0);
    expect(r.lcFindings.every((f) => f.basis.length > 0)).toBe(true);
    expect(r.docFindings.map((f) => f.severity)).toContain("discrepancy");
    expect(r.meta.map(([k]) => k)).toEqual(["案件", "信用证号", "审查时间", "报告生成时间", "规则库版本"]);
  });

  it("修改清单按「要改哪里」分组并保持固定顺序；提示类不进清单", () => {
    const r = buildReport(input("zh"));
    expect(r.actions.map((g) => g.title)).toEqual(["信用证 / 与申请人沟通", "商业发票", "运输单据", "保险单据"]);
    const all = r.actions.flatMap((g) => g.items);
    expect(all.some((i) => i.severity === "info")).toBe(false);
    expect(all.find((i) => i.text.includes("装运日"))).toBeDefined();
  });

  it("使用审查当时的单据数据快照", () => {
    const r = buildReport(input("zh"));
    const flat = r.presentation!.flatMap((g) => g.rows).map(([, v]) => v);
    expect(flat).toContain("OTHER LTD");
    expect(flat).toContain("NINGBO");
    expect(r.presentation!.map((g) => g.title)).toEqual(["交单信息", "商业发票", "运输单据", "保险单据"]);
  });

  it("英文报告：标题、分级、文案全部为英文", () => {
    const r = buildReport(input("en"));
    expect(r.title).toBe("L/C Compliance Self-Check Report");
    expect(r.summary.headline).toMatch(/discrepancy/);
    expect(r.docFindings[0]!.severityLabel).toBe("Discrepancy");
    expect(r.coverage.every((c) => /[A-Za-z]/.test(c.title))).toBe(true);
    // 案件名是用户数据（含中文），其余由软件生成的文字都不应出现中文
    const generated = [
      r.title,
      r.subtitle,
      r.summary.headline,
      ...r.disclaimer,
      ...r.coverage.map((c) => c.title + c.label),
      ...r.lcFindings.map((f) => f.message + (f.suggestion ?? "") + f.basis),
      ...r.docFindings.map((f) => f.message + (f.suggestion ?? "") + f.basis),
      ...r.actions.flatMap((g) => [g.title, ...g.items.map((i) => i.text)]),
    ];
    for (const text of generated) expect(text).not.toMatch(/[一-鿿]/);
  });

  it("只做了审证：说明尚未录入交单数据，且不声称单据合规", () => {
    const lcOnly = make(LC).input("zh");
    const r = buildReport(lcOnly);
    expect(r.presentation).toBeNull();
    expect(r.summary.headline).toContain("尚未录入交单数据");
    expect(r.docFindings).toEqual([]);
    expect(r.coverage.some((c) => c.status === "skipped")).toBe(true);
  });

  it("没有任何发现时措辞保守，不说「合规」", () => {
    const clean = make(
      [":20:OK", ":31D:241130", ":32B:USD100000,00", ":44C:241001", ":50:ACME IMPORTS INC", ":59:SANDNES TRADING CO LTD", ":45A:WIDGETS"].join("\n"),
      { presentationDate: "2024-10-05", invoice: { currency: "USD", amount: 1000 }, transport: { shipmentDate: "2024-09-30" } },
    );
    const r = buildReport(clean.input("zh"));
    expect(r.summary.tone).toBe("ok");
    expect(r.summary.headline).toContain("不代表单据完全合规");
    expect(r.actions).toEqual([]);
  });

  it("分组映射覆盖所有规则编码", () => {
    const f = (code: string) => ({ code }) as never;
    expect(actionGroupOf(f("lc.soft.applicantDoc"))).toBe("lc");
    expect(actionGroupOf(f("shipment.late"))).toBe("lc");
    expect(actionGroupOf(f("presentation.stale"))).toBe("timing");
    expect(actionGroupOf(f("invoice.goodsMismatch"))).toBe("invoice");
    expect(actionGroupOf(f("transport.portGeneric"))).toBe("transport");
    expect(actionGroupOf(f("insurance.dateLate"))).toBe("insurance");
  });
});

describe("renderReportHtml", () => {
  it("转义所有来自单据的内容（防止注入脚本/标签），并带严格 CSP", () => {
    const evil = `<img src=x onerror=alert(1)> & "q"`;
    const { input } = make(LC, { ...BAD, invoice: { ...BAD.invoice, sellerName: evil, goodsDescription: `<script>alert(1)</script>\nline2` } });
    const html = renderReportHtml(buildReport(input("zh")));
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;<br>line2");
    expect(html).toContain("default-src 'none'");
    expect(esc(`'<>&"`)).toBe("&#39;&lt;&gt;&amp;&quot;");
  });

  it("包含各章节与不符点内容", () => {
    const html = renderReportHtml(buildReport(make(LC, BAD).input("zh")));
    for (const t of ["信用证合规自查报告", "一、结论摘要", "六、修改清单", "七、检查清单", "八、说明与免责声明", "发票货物描述与信用证 45A 不相符", "ul class=\"todo\""]) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain('lang="zh-CN"');
  });

  it("英文报告标注 lang=en", () => {
    expect(renderReportHtml(buildReport(make(LC, BAD).input("en")))).toContain('lang="en"');
  });
});

describe("renderReportDocx", () => {
  async function xml(bytes: Uint8Array, file = "word/document.xml") {
    const zip = await JSZip.loadAsync(bytes);
    return { zip, text: await zip.file(file)!.async("string") };
  }

  it("生成合法的 docx（zip，含 [Content_Types].xml），正文含标题、发现与修改清单", async () => {
    const bytes = await renderReportDocx(buildReport(make(LC, BAD).input("zh")));
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]); // PK
    const { zip, text } = await xml(bytes);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    for (const t of ["信用证合规自查报告", "RPT-1", "货物描述与信用证 45A 不相符", "☐", "装运港", "修改清单"]) {
      expect(text, t).toContain(t);
    }
    // 页脚页码
    const footer = Object.keys(zip.files).find((f) => f.startsWith("word/footer"));
    expect(footer).toBeDefined();
  });

  it("特殊字符被正确转义，多行文本不丢失", async () => {
    const { input } = make(LC, { ...BAD, invoice: { ...BAD.invoice, sellerName: "A & B <Co>", goodsDescription: "line1\nline2" } });
    const { text } = await xml(await renderReportDocx(buildReport(input("en"))));
    expect(text).toContain("A &amp; B &lt;Co&gt;");
    expect(text).toContain("line1");
    expect(text).toContain("line2");
    expect(text).toContain("L/C Compliance Self-Check Report");
  });
});

describe("reportFileName", () => {
  it("去掉文件名中的非法字符，带语言和日期", () => {
    expect(reportFileName('客户A / 8月:出口*?"', "zh", "2026-11-04T08:30:00Z", "pdf")).toBe("客户A _ 8月_出口___-审单报告-2026-11-04.pdf");
    expect(reportFileName("Case 1", "en", "2026-11-04", "docx")).toBe("Case 1-check-report-2026-11-04.docx");
    expect(reportFileName("...", "en", "2026-11-04", "pdf")).toBe("case-check-report-2026-11-04.pdf");
  });
});

describe("自定义检查项在报告中的呈现", () => {
  function withCustom() {
    const store = new CaseStore();
    const c = store.createCase({ name: "n", lcText: LC });
    store.addDocument({ caseId: c.id, docType: "transport", fileName: "bl.pdf", sourceKind: "pdf", text: "FREIGHT COLLECT", chars: 15, needsOcr: false });
    store.addCheckItems(
      [
        { draft: { title: "提单注明运费预付", requirement: "提单须注明 FREIGHT PREPAID", kind: "text", scope: "transport", severity: "discrepancy", textMatch: { mode: "all", phrases: ["FREIGHT PREPAID"] } }, source: { manualId: "m", manualName: "公司审单清单", quote: "提单须注明 FREIGHT PREPAID" }, origin: "ai" },
        { draft: { title: "电话确认买方", requirement: "发运前电话确认", kind: "manual", scope: "invoice", severity: "info" }, source: null, origin: "user" },
      ],
      "enabled",
    );
    const run = store.runCase(c.id);
    return buildReport({ caseName: c.name, lc: c.lc, run, generatedAt: "2026-11-04T08:30:00.000Z", lang: "zh" });
  }

  it("依据写成「自定义检查项（出处）」，不暴露内部规则 ID；手工添加的标明手工", () => {
    const r = withCustom();
    const custom = r.docFindings.filter((f) => f.basis.includes("自定义检查项"));
    expect(custom.map((f) => f.basis).sort()).toEqual(["依据：自定义检查项（出处：公司审单清单）", "依据：自定义检查项（出处：手工添加）"]);
    expect(JSON.stringify(r)).not.toMatch(/CUSTOM-[0-9a-f]{8}/);
  });

  it("针对单据的人工核对项归入审单；修改清单按单据分组；检查清单用检查项标题", () => {
    const r = withCustom();
    expect(r.lcFindings.some((f) => f.message.includes("电话确认买方"))).toBe(false);
    expect(r.docFindings.some((f) => f.message.includes("电话确认买方"))).toBe(true);
    const groups = Object.fromEntries(r.actions.map((g) => [g.title, g.items.length]));
    expect(groups["运输单据"]).toBe(1);
    expect(groups["商业发票"]).toBe(1);
    expect(r.coverage.map((c) => c.title)).toEqual(expect.arrayContaining(["提单注明运费预付", "电话确认买方"]));
  });
});

describe("国别规则与船东单在报告中的呈现", () => {
  const BD_LC = `:52A:TESTBDDHXXX
${LC}`;
  const pres = (issuerName: string, signingCapacity?: string): Presentation => ({
    presentationDate: "2024-10-15",
    transport: { shipmentDate: "2024-10-10", portOfLoading: "NINGBO", portOfDischarge: "NEW YORK", issuerName, signingCapacity },
  });
  const fwd = make(BD_LC, pres("ABC LOGISTICS CO", "as agent"));
  const conf = make(BD_LC, pres("XYZ SHIPPING CO"));

  it("运输类修改清单：carrierBl 发现归入「运输单据」", () => {
    for (const m of [fwd, conf]) {
      const r = buildReport(m.input("zh"));
      const code = m === fwd ? "carrierBl.forwarder" : "carrierBl.confirm";
      expect(m.run.findings.some((f) => f.code === code)).toBe(true);
      expect(actionGroupOf(m.run.findings.find((f) => f.code === code)!)).toBe("transport");
      const g = r.actions.find((x) => x.title === "运输单据")!;
      expect(g.items.length).toBeGreaterThan(0);
    }
  });

  it("中英文标题、国别规则来源与签发人事实行；不再出现「手册依据」", () => {
    expect(fwd.run.findings.some((f) => f.code === "country.hit")).toBe(true);
    const zh = buildReport(fwd.input("zh"));
    const en = buildReport(fwd.input("en"));
    const evZh = [...zh.lcFindings, ...zh.docFindings].flatMap((f) => f.evidence);
    const evEn = [...en.lcFindings, ...en.docFindings].flatMap((f) => f.evidence);
    expect(evZh.some((e) => e.source === "国别规则")).toBe(true);
    expect(evEn.some((e) => e.source === "Country rule")).toBe(true);
    expect(evZh.some((e) => e.source === "手册依据")).toBe(false);
    expect(evEn.some((e) => e.source === "Manual source")).toBe(false);
    expect(evZh.some((e) => e.value.includes("必须船东单") && e.value.includes("Carrier-issued bill of lading required"))).toBe(true);
    const html = renderReportHtml(zh);
    expect(html).toContain("国别规则");
    expect(html).not.toContain("手册依据");

    const tz = zh.presentation!.find((g) => g.title === "运输单据")!.rows;
    expect(tz).toContainEqual(["提单签发人", "ABC LOGISTICS CO"]);
    expect(tz).toContainEqual(["签发身份", "as agent"]);
    const te = en.presentation!.find((g) => g.title === "Transport document")!.rows;
    expect(te).toContainEqual(["B/L issuer", "ABC LOGISTICS CO"]);
    expect(te).toContainEqual(["Signing capacity", "as agent"]);

    const cz = buildReport(conf.input("zh"));
    const ce = buildReport(conf.input("en"));
    expect(zh.docFindings.some((f) => f.message.includes("看起来是货代"))).toBe(true);
    expect(en.docFindings.some((f) => f.message.includes("the issuer looks like a forwarder"))).toBe(true);
    expect(cz.docFindings.some((f) => f.message.includes("无法确认提单是否由承运人签发"))).toBe(true);
    expect(ce.docFindings.some((f) => f.message.includes("cannot be confirmed"))).toBe(true);
    expect(zh.lcFindings.some((f) => f.message.includes("开证行所在国家"))).toBe(true);
    expect(en.lcFindings.some((f) => f.message.includes("Issuing bank country"))).toBe(true);
  });
});
