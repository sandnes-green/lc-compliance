import { describe, expect, it } from "vitest";
import type { Language } from "../src/shared/api";
import { DICTS } from "../src/renderer/src/i18n-dicts";
import { GUIDE, blockTexts, quickStartSteps, resolveGuideText, searchGuide, type Block } from "../src/renderer/src/guide-content";

const LANGS: Language[] = ["zh", "en"];
const KEY = /\{\{([\w.]+)\}\}/g;

const allTexts = (lang: Language) => GUIDE[lang].flatMap((s) => [s.title, ...s.blocks.flatMap(blockTexts)]);

describe("使用指南与界面保持一致", () => {
  it.each(LANGS)("[%s] 指南里引用的每个界面文案都真实存在", (lang) => {
    const dict = DICTS[lang];
    const missing: string[] = [];
    for (const text of allTexts(lang)) for (const m of text.matchAll(KEY)) if (!dict[m[1]!]) missing.push(m[1]!);
    expect(missing, `字典里找不到：${[...new Set(missing)].join(", ")}`).toEqual([]);
  });

  it.each(LANGS)("[%s] 替换后的文字里不会残留占位符（引用了带参数的文案会留下 {n} 之类）", (lang) => {
    const dict = DICTS[lang];
    for (const text of allTexts(lang)) {
      const out = resolveGuideText(text, dict);
      expect(out, text).not.toMatch(/\{\{|\}\}/);
      expect(out, text).not.toMatch(/\{\w+\}/);
    }
  });

  it("中英文指南结构一致：小节、区块类型与条目数都对得上", () => {
    const shape = (lang: Language) =>
      GUIDE[lang].map((s) => ({
        id: s.id,
        blocks: s.blocks.map((b: Block) => `${b.type}${"items" in b ? ":" + b.items.length : ""}`),
      }));
    expect(shape("en")).toEqual(shape("zh"));
  });

  it.each(LANGS)("[%s] 每个小节都有标题与内容，步骤至少两步，没有空文字或遗留标记", (lang) => {
    for (const s of GUIDE[lang]) {
      expect(s.title.trim(), s.id).not.toBe("");
      expect(s.blocks.length, s.id).toBeGreaterThan(0);
      for (const b of s.blocks) {
        if (b.type === "steps") expect(b.items.length, s.id).toBeGreaterThanOrEqual(2);
        for (const t of blockTexts(b)) {
          expect(t.trim(), s.id).not.toBe("");
          expect(t, s.id).not.toMatch(/TODO|FIXME|undefined/);
        }
      }
    }
    expect(new Set(GUIDE[lang].map((s) => s.id)).size).toBe(GUIDE[lang].length); // 小节 ID 不重复（用于目录跳转）
  });

  it("所有版本都包含需要的小节，且「第一次使用」的快速上手恰好 6 步", () => {
    for (const lang of LANGS) {
      const ids = GUIDE[lang].map((s) => s.id);
      for (const must of ["about", "quickstart", "step-case", "step-docs", "step-result", "step-report", "safety", "faq", "terms"]) expect(ids, `${lang}:${must}`).toContain(must);
      expect(quickStartSteps(lang)).toHaveLength(6);
    }
  });

  it.each(LANGS)("[%s] 严重程度四个级别都有解释，并覆盖字典里的名称", (lang) => {
    const sev = GUIDE[lang].flatMap((s) => s.blocks).find((b) => b.type === "severity");
    expect(sev && sev.type === "severity" ? sev.items.map((i) => i.sev) : []).toEqual(["discrepancy", "risk", "doubt", "info"]);
    for (const k of ["discrepancy", "risk", "doubt", "info"]) expect(DICTS[lang][`sev.${k}`], k).toBeTruthy();
  });

  it("名词词典涵盖新手最需要的术语", () => {
    const terms = GUIDE.zh.find((s) => s.id === "terms")!.blocks.flatMap((b) => (b.type === "terms" ? b.items.map((i) => i.term) : []));
    for (const t of ["信用证", "受益人", "申请人", "不符点", "有效期", "最迟装运日", "交单期", "提单", "软条款", "UCP 600", "MT700", "OCR"]) {
      expect(terms.some((x) => x.includes(t)), t).toBe(true);
    }
  });

  it("指南的诚实性：必须明确说明这只是自查工具、没发现问题不等于合规、「未检查」不等于通过、没备份会丢数据", () => {
    const zh = allTexts("zh").join("\n");
    for (const must of ["自查工具", "不等于银行一定不挑毛病", "不等于没问题", "未检查", "无法找回", "对照原单据核对"]) {
      expect(zh, must).toContain(must);
    }
    const en = allTexts("en").join("\n");
    for (const must of ["self-check tool", "does not mean", "cannot be recovered", "original"]) expect(en, must).toContain(must);
  });
});

describe("搜索", () => {
  const dict = (l: Language) => DICTS[l];

  it("空关键词返回全部", () => {
    expect(searchGuide("zh", dict("zh"), "  ")).toHaveLength(GUIDE.zh.length);
  });
  it("能按正文关键词找到相关小节（含引用界面文案的位置）", () => {
    const ids = (q: string) => searchGuide("zh", dict("zh"), q).map((s) => s.id);
    expect(ids("扫描件")).toEqual(expect.arrayContaining(["step-docs", "faq"]));
    expect(ids("备份")).toContain("safety");
    expect(ids("软条款")).toEqual(expect.arrayContaining(["step-lc-review", "terms"]));
    expect(ids("保存并审查")).toEqual(expect.arrayContaining(["quickstart", "step-docs"])); // 来自 {{btn.saveRun}} 解析后的文字
  });
  it("英文搜索忽略大小写；加粗标记不影响匹配；无结果返回空", () => {
    const en = (q: string) => searchGuide("en", dict("en"), q).map((s) => s.id);
    expect(en("BACKUP")).toContain("safety");
    expect(en("one thing")).toContain("about"); // 原文是 **even one thing**
    expect(en("zzzzqqq")).toEqual([]);
  });
});
