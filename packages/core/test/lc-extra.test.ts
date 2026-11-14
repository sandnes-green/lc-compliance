import { describe, expect, it } from "vitest";
import { allRules, formAndRules, localizeFinding, parseMt700, partialTranship, presentationConflict, RULE_TITLES, tolerance } from "../src";
import type { LetterOfCredit } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const base = parseMt700(SAMPLE_MT700);
const lcWith = (patch: Partial<LetterOfCredit>): LetterOfCredit => ({ ...base, ...patch });
const withRaw = (raw: Record<string, string>, patch: Partial<LetterOfCredit> = {}): LetterOfCredit => ({ ...base, ...patch, raw: { ...base.raw, ...raw } });
const codes = (fs: { code: string }[]) => fs.map((f) => f.code);

describe("容差 Art.30", () => {
  it("样本（39A 05/05，货描以 SETS 计数）没有发现", () => {
    expect(tolerance.evaluate({ lc: base })).toEqual([]);
  });
  it("单侧容差 → 提示", () => {
    expect(codes(tolerance.evaluate({ lc: lcWith({ tolerance: { plus: 0, minus: 5 } }) }))).toEqual(["lc.tolerance.oneSided"]);
    expect(tolerance.evaluate({ lc: lcWith({ tolerance: { plus: 0, minus: 0 } }) })).toEqual([]);
  });
  it("容差超过 10% → 疑点", () => {
    const f = tolerance.evaluate({ lc: lcWith({ tolerance: { plus: 15, minus: 5 } }) });
    expect(codes(f)).toEqual(["lc.tolerance.large"]);
    expect(f[0]!.severity).toBe("doubt");
  });
  it("「约」与 39A 并存 → 疑点；只有「约」没有 39A 不报", () => {
    const goods = "ABOUT 1000 SETS OF WIDGETS";
    expect(codes(tolerance.evaluate({ lc: lcWith({ goodsDescription: goods }) }))).toEqual(["lc.tolerance.aboutStacked"]);
    expect(tolerance.evaluate({ lc: lcWith({ goodsDescription: goods, tolerance: undefined }) })).toEqual([]);
  });
  it("按件计数且没有容差 → 提示 ±5% 不适用，证据带原文", () => {
    const f = tolerance.evaluate({ lc: lcWith({ tolerance: undefined, goodsDescription: "1,000 SETS OF WIDGETS MODEL X" }) });
    expect(codes(f)).toEqual(["lc.tolerance.discreteUnits"]);
    expect(f[0]!.evidence[0]!.value).toContain("1,000 SETS");
  });
  it("按重量计、没有容差 → 不报", () => {
    expect(tolerance.evaluate({ lc: lcWith({ tolerance: undefined, goodsDescription: "500 METRIC TONS OF STEEL" }) })).toEqual([]);
  });
});

describe("分批装运与转运 Art.31 / 20(c)", () => {
  const run = (patch: Partial<LetterOfCredit>) => codes(partialTranship.evaluate({ lc: lcWith({ additionalConditions: "", ...patch }) }));
  it("ALLOWED 不报；NOT ALLOWED 提示", () => {
    expect(run({ partialShipments: "ALLOWED", transhipment: "ALLOWED" })).toEqual([]);
    expect(run({ partialShipments: "NOT ALLOWED" })).toEqual(["lc.partial.notAllowed"]);
    expect(run({ transhipment: "NOT ALLOWED" })).toEqual(["lc.tranship.notAllowed"]);
  });
  it("没有 43P / 43T 或写法不认识 → 不报", () => {
    expect(run({ partialShipments: undefined, transhipment: undefined })).toEqual([]);
    expect(run({ partialShipments: "SEE FIELD 47A" })).toEqual([]);
  });
  it("CONDITIONAL → 疑点，且不再比对条款文字", () => {
    const f = partialTranship.evaluate({ lc: lcWith({ partialShipments: "CONDITIONAL", additionalConditions: "+PARTIAL SHIPMENTS NOT ALLOWED" }) });
    expect(codes(f)).toEqual(["lc.partial.conditional"]);
    expect(f[0]!.severity).toBe("doubt");
  });
  it("43P 与条款文字矛盾 → 风险，证据含两处", () => {
    const f = partialTranship.evaluate({ lc: lcWith({ partialShipments: "NOT ALLOWED", additionalConditions: "+PARTIAL SHIPMENTS ARE ALLOWED" }) });
    expect(codes(f)).toEqual(["lc.partial.notAllowed", "lc.partial.conflict"]);
    const conflict = f[1]!;
    expect(conflict.severity).toBe("risk");
    expect(conflict.evidence.map((e) => e.field)).toEqual(["43P", "47A"]);
  });
  it("43T ALLOWED 但文字写 NO TRANSHIPMENT / TRANSSHIPMENT 拼写变体", () => {
    expect(run({ transhipment: "ALLOWED", additionalConditions: "+NO TRANSHIPMENT" })).toEqual(["lc.tranship.conflict"]);
    expect(run({ transhipment: "NOT ALLOWED", additionalConditions: "+TRANSSHIPMENT IS PERMITTED" })).toEqual(["lc.tranship.notAllowed", "lc.tranship.conflict"]);
    expect(run({ transhipment: "NOT ALLOWED", additionalConditions: "+TRANS-SHIPMENT PROHIBITED" })).toEqual(["lc.tranship.notAllowed"]);
  });
  it("字段与文字一致 → 不报矛盾", () => {
    expect(run({ partialShipments: "ALLOWED", additionalConditions: "+PARTIAL SHIPMENTS ALLOWED" })).toEqual([]);
  });
  it("同一事项的矛盾只报一次", () => {
    const f = run({ partialShipments: "ALLOWED", additionalConditions: "+NO PARTIAL SHIPMENT. PARTIAL SHIPMENTS NOT ALLOWED", documentsRequired: "+PARTIAL SHIPMENTS PROHIBITED" });
    expect(f.filter((c) => c === "lc.partial.conflict")).toHaveLength(1);
  });
});

describe("交单期与到期日被重复规定 Art.14(c)", () => {
  const run = (patch: Partial<LetterOfCredit>) => presentationConflict.evaluate({ lc: lcWith({ presentationDays: 21, expiryDate: "2024-09-30", ...patch }) });
  it("样本没有发现", () => {
    expect(presentationConflict.evaluate({ lc: base })).toEqual([]);
  });
  it("条款文字里的交单天数与 48 不同 → 疑点", () => {
    const f = run({ additionalConditions: "+DOCUMENTS MUST BE PRESENTED WITHIN 15 DAYS AFTER SHIPMENT DATE" });
    expect(codes(f)).toEqual(["lc.presentation.daysConflict"]);
    expect(f[0]!.params).toMatchObject({ fieldDays: 21, textDays: 15 });
    expect(f[0]!.severity).toBe("doubt");
  });
  it("天数相同、汇票期限、与交单无关的天数 → 不报", () => {
    expect(run({ additionalConditions: "+DOCUMENTS MUST BE PRESENTED WITHIN 21 DAYS AFTER SHIPMENT DATE" })).toEqual([]);
    expect(run({ additionalConditions: "+PRESENT DOCUMENTS TO US. DRAFTS AT 60 DAYS AFTER B/L DATE" })).toEqual([]);
    expect(run({ additionalConditions: "+PAYMENT WITHIN 10 DAYS AFTER ARRIVAL" })).toEqual([]);
  });
  it("没有 48 字段时不比对天数", () => {
    expect(run({ presentationDays: undefined, additionalConditions: "+DOCUMENTS MUST BE PRESENTED WITHIN 15 DAYS AFTER SHIPMENT" })).toEqual([]);
  });
  it("条款文字里另一个到期日 → 疑点（双到期）", () => {
    const f = run({ additionalConditions: "+THIS CREDIT EXPIRES ON 15 OCT 2024 AT OUR COUNTERS" });
    expect(codes(f)).toEqual(["lc.expiry.textConflict"]);
    expect(f[0]!.params).toMatchObject({ expiry: "2024-09-30", textDate: "2024-10-15" });
  });
  it("到期日与 31D 相同（含 30SEP24、ISO 写法）→ 不报", () => {
    expect(run({ additionalConditions: "+THIS CREDIT EXPIRES ON 30 SEP 2024" })).toEqual([]);
    expect(run({ additionalConditions: "+VALID UNTIL 30SEP24" })).toEqual([]);
    expect(run({ documentsRequired: "+VALIDITY: 2024-09-30" })).toEqual([]);
  });
  it("没有具体日期的「有效期」字样、有歧义的纯数字日期 → 不报", () => {
    expect(run({ additionalConditions: "+WITHIN THE VALIDITY OF THE CREDIT" })).toEqual([]);
    expect(run({ additionalConditions: "+EXPIRES ON 05/10/2024" })).toEqual([]);
  });
});

describe("信用证类型与适用规则 40A / 40E", () => {
  const run = (lc: LetterOfCredit) => codes(formAndRules.evaluate({ lc }));
  it("样本没有 40E → 疑点；补上 UCP LATEST VERSION 后无发现", () => {
    expect(run(base)).toEqual(["lc.rules.missing"]);
    expect(run(withRaw({ "40E": "UCP LATEST VERSION" }))).toEqual([]);
    expect(run(withRaw({ "40E": "UCPURR LATEST VERSION" }))).toEqual([]);
  });
  it("可撤销 → 风险；IRREVOCABLE 不误报", () => {
    const e = { "40E": "UCP LATEST VERSION" };
    expect(run(withRaw(e, { form: "REVOCABLE" }))).toEqual(["lc.form.revocable"]);
    expect(run(withRaw(e, { form: "REVOC" }))).toEqual(["lc.form.revocable"]);
    expect(run(withRaw(e, { form: "IRREVOCABLE" }))).toEqual([]);
    expect(run(withRaw(e, { form: "IRREVOC" }))).toEqual([]);
  });
  it("可转让、备用证 → 提示；没有 40A → 疑点", () => {
    const e = { "40E": "UCP LATEST VERSION" };
    expect(run(withRaw(e, { form: "IRREVOCABLE TRANSFERABLE" }))).toEqual(["lc.form.transferable"]);
    expect(run(withRaw(e, { form: "IRREVOC STANDBY" }))).toEqual(["lc.form.standby"]);
    expect(run(withRaw(e, { form: undefined }))).toEqual(["lc.form.missing"]);
  });
  it("40E 为 ISP / URDG → 疑点；OTHR → 风险；其他写法 → 疑点", () => {
    expect(run(withRaw({ "40E": "ISP LATEST VERSION" }))).toEqual(["lc.rules.nonUcp"]);
    expect(run(withRaw({ "40E": "URDG LATEST VERSION" }))).toEqual(["lc.rules.nonUcp"]);
    const other = formAndRules.evaluate({ lc: withRaw({ "40E": "OTHR\nLOCAL BANK RULES" }) });
    expect(codes(other)).toEqual(["lc.rules.other"]);
    expect(other[0]!.severity).toBe("risk");
    expect(run(withRaw({ "40E": "SOMETHING ELSE" }))).toEqual(["lc.rules.unknown"]);
  });
  it("条款文字引用 UCP 500 → 风险；UCP 600 不误报", () => {
    const e = { "40E": "UCP LATEST VERSION" };
    expect(run(withRaw(e, { additionalConditions: "+THIS CREDIT IS SUBJECT TO UCP 500" }))).toEqual(["lc.rules.oldUcp"]);
    expect(run(withRaw(e, { additionalConditions: "+ICC PUBLICATION NO. 500 APPLIES" }))).toEqual(["lc.rules.oldUcp"]);
    expect(run(withRaw(e, { additionalConditions: "+SUBJECT TO UCP 600" }))).toEqual([]);
  });
});

describe("规则登记", () => {
  const ids = ["LCR-TOLERANCE", "LCR-PARTIAL-TRANSHIP", "LCR-PRESENTATION-CONFLICT", "LCR-FORM-RULES"];
  it("四条规则已进入 allRules 并有中英文名称", () => {
    for (const id of ids) {
      expect(allRules.some((r) => r.id === id && r.stage === "lc"), id).toBe(true);
      expect(RULE_TITLES[id]?.zh).toBeTruthy();
      expect(RULE_TITLES[id]?.en).toBeTruthy();
    }
  });
  it("所有可能产生的发现都有中英文文案，且没有残留占位符", () => {
    const lcs: LetterOfCredit[] = [
      lcWith({ tolerance: { plus: 0, minus: 20 }, goodsDescription: "ABOUT 10 SETS" }),
      lcWith({ tolerance: undefined, goodsDescription: "10 SETS" }),
      lcWith({
        partialShipments: "NOT ALLOWED",
        transhipment: "NOT ALLOWED",
        additionalConditions: "+PARTIAL SHIPMENTS ALLOWED +TRANSHIPMENT ALLOWED +PRESENT DOCUMENTS WITHIN 9 DAYS AFTER SHIPMENT +EXPIRES ON 01 DEC 2030 +UCP 500",
        expiryDate: "2024-09-30",
        presentationDays: 21,
      }),
      lcWith({ partialShipments: "CONDITIONAL", transhipment: "CONDITIONAL" }),
      withRaw({ "40E": "OTHR X" }, { form: "REVOCABLE TRANSFERABLE STANDBY" }),
      withRaw({ "40E": "ISP LATEST VERSION" }, { form: undefined }),
      withRaw({ "40E": "???" }),
    ];
    const seen = new Set<string>();
    for (const lc of lcs) {
      for (const rule of [tolerance, partialTranship, presentationConflict, formAndRules]) {
        for (const f of rule.evaluate({ lc })) {
          seen.add(f.code);
          for (const lang of ["zh", "en"] as const) {
            const m = localizeFinding(f, lang);
            expect(m.message, `${f.code}/${lang}`).not.toMatch(/\{\w+\}/);
            expect(m.suggestion ?? "", `${f.code}/${lang}`).not.toMatch(/\{\w+\}/);
          }
          expect(localizeFinding(f, "en").message, f.code).not.toBe(f.message);
        }
      }
    }
    // 21 个编码全部被触发过，目录里没有多余或遗漏的项
    expect([...seen].sort()).toEqual(
      [
        "lc.expiry.textConflict",
        "lc.form.missing",
        "lc.form.revocable",
        "lc.form.standby",
        "lc.form.transferable",
        "lc.partial.conditional",
        "lc.partial.conflict",
        "lc.partial.notAllowed",
        "lc.presentation.daysConflict",
        "lc.rules.missing",
        "lc.rules.nonUcp",
        "lc.rules.oldUcp",
        "lc.rules.other",
        "lc.rules.unknown",
        "lc.tolerance.aboutStacked",
        "lc.tolerance.discreteUnits",
        "lc.tolerance.large",
        "lc.tolerance.oneSided",
        "lc.tranship.conditional",
        "lc.tranship.conflict",
        "lc.tranship.notAllowed",
      ].sort(),
    );
  });
});
