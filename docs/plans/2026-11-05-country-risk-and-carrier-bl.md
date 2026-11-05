# 国别规则表与船东单核对 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从 MT700 的 52A 读出开证行国家，按用户可编辑的“国别规则表”在审证阶段给出提示；并在审单阶段核对“必须船东单”要求（来源为信用证条款或国别规则）。

**Architecture:** 核心包保持纯 TypeScript、无 IO：新增 `countryRules.ts`（模型、校验、起步清单）、`rules/countryRisk.ts`（审证规则工厂）、`rules/carrierBl.ts`（条款识别 + 审单规则工厂）。国别规则是数据，不是常量，所以规则以工厂函数形式在 `CaseStore.runCase` 里用当前数据库中的国别规则动态构建（与 `buildCustomRules` 同一做法）。存储层新增 `country_rules` 表（敏感列加密，首次打开时写入起步清单）。桌面端新增三条 IPC、一个“国别规则”管理窗口，并在运输单据表单里增加“签发人 / 签发身份”两个字段。

**Tech Stack:** TypeScript、Vitest、node:sqlite、Electron + React + Ant Design。

**设计依据：** `docs/plans/2026-11-05-lc-risk-and-docs-design.md` 第一、二节。

**通用约定（每个任务都适用）：**
- 在仓库根目录 `F:\sandnes\LC` 下运行命令。单包测试：`npm test -w @lc/core -- test/某文件.test.ts`。
- 提交信息末尾加：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。
- 本仓库有提交前钩子：暂存后先运行 `/patch-quality-score`，把评分展示给用户并征得同意，同意后重新执行 `git commit` 并在命令末尾追加 ` # reviewed`。下面各任务的“Commit”步骤都按这个流程执行，不再重复。
- 所有测试数据必须是合成数据。

---

### Task 1: MT700 读出开证行 BIC 与国家

**Files:**
- Modify: `packages/core/src/model.ts`（`LetterOfCredit`）
- Modify: `packages/core/src/mt700.ts`
- Test: `packages/core/test/mt700-bank.test.ts`（新建）

**Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { parseBank, parseMt700 } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

describe("52A 开证行", () => {
  it("取 BIC 与第 5、6 位国家代码", () => {
    expect(parseBank("TESTBDDHXXX")).toEqual({ bic: "TESTBDDHXXX", country: "BD" });
    expect(parseBank("TESTTRIS")).toEqual({ bic: "TESTTRIS", country: "TR" });
  });
  it("跳过首行 /账号 或 /D/ 标识", () => {
    expect(parseBank("/D/12345\nTESTBDDHXXX")).toEqual({ bic: "TESTBDDHXXX", country: "BD" });
  });
  it("无法识别时返回空，不猜", () => {
    expect(parseBank(undefined)).toEqual({});
    expect(parseBank("SOME BANK LTD\nDHAKA")).toEqual({});
    expect(parseBank("test1")).toEqual({});
  });
  it("parseMt700 写入 issuingBankBic / issuingCountry；没有 52A 时为空", () => {
    const lc = parseMt700(SAMPLE_MT700.replace(":27:1/1", ":27:1/1\n:52A:TESTBDDHXXX"));
    expect(lc.issuingBankBic).toBe("TESTBDDHXXX");
    expect(lc.issuingCountry).toBe("BD");
    const none = parseMt700(SAMPLE_MT700);
    expect(none.issuingBankBic).toBeUndefined();
    expect(none.issuingCountry).toBeUndefined();
  });
});
```

**Step 2: 运行确认失败**

Run: `npm test -w @lc/core -- test/mt700-bank.test.ts`
Expected: FAIL，`parseBank is not a function`（或未导出）。

**Step 3: 实现**

`model.ts` 的 `LetterOfCredit` 里，在 `form?: string;` 之后加入：

```ts
  /** 52A：开证行 BIC 及其第 5、6 位国家代码；52D 等无 BIC 的写法读不出，保持为空 */
  issuingBankBic?: string;
  issuingCountry?: string;
```

`mt700.ts` 在 `partyName` 之后加入：

```ts
const BIC = /^[A-Z]{4}([A-Z]{2})[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;

/** 52A：可选的首行 /账号 或 /D/…，其后是 BIC。只在整行恰好是合法 BIC 时才取国家，其余一律不猜 */
export function parseBank(field?: string): { bic?: string; country?: string } {
  const line = field
    ?.split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("/"))
    .pop();
  const m = line ? BIC.exec(line) : null;
  return m ? { bic: line, country: m[1] } : {};
}
```

在 `parseMt700` 里 `if (f["40A"]) lc.form = ...` 之后加入：

```ts
  const bank = parseBank(f["52A"]);
  lc.issuingBankBic = bank.bic;
  lc.issuingCountry = bank.country;
```

**Step 4: 运行确认通过**

Run: `npm test -w @lc/core -- test/mt700-bank.test.ts` 与 `npm test -w @lc/core`
Expected: 全部 PASS（旧测试不受影响，新增字段为 undefined）。

**Step 5: Commit**

```bash
git add packages/core/src/model.ts packages/core/src/mt700.ts packages/core/test/mt700-bank.test.ts
git commit -m "feat(core): MT700 读取 52A 开证行 BIC 与国家"
```

---

### Task 2: 国别规则的数据模型、校验与起步清单

**Files:**
- Create: `packages/core/src/countryRules.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/countryRules.test.ts`（新建）

**Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { parseCountryRuleDraft, regionName, STARTER_COUNTRY_RULES } from "../src";

const good = { countryCode: "bd", level: "notice", requirements: ["carrierBl"], note: "x", enabled: true, reviewed: false };

describe("国别规则校验", () => {
  it("接受合法内容，国家代码规范成大写", () => {
    const r = parseCountryRuleDraft(good);
    expect(r.ok && r.draft.countryCode).toBe("BD");
  });
  it.each([
    [{ ...good, countryCode: "BGD" }, "countryCode"],
    [{ ...good, countryCode: "" }, "countryCode"],
    [{ ...good, level: "x" }, "level"],
    [{ ...good, requirements: ["nope"] }, "requirements"],
    [{ ...good, requirements: "carrierBl" }, "requirements"],
    [{ ...good, note: 5 }, "note"],
    [{ ...good, enabled: "yes" }, "enabled"],
    [null, "root"],
  ])("拒绝非法内容 %#", (raw, field) => {
    const r = parseCountryRuleDraft(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(field);
  });
  it("去重要求事项，备注限长", () => {
    const r = parseCountryRuleDraft({ ...good, requirements: ["carrierBl", "carrierBl"] });
    expect(r.ok && r.draft.requirements).toEqual(["carrierBl"]);
    expect(parseCountryRuleDraft({ ...good, note: "a".repeat(2001) }).ok).toBe(false);
  });
});

describe("起步清单", () => {
  it("只有孟加拉与土耳其，只含船东单，并且都是未审核", () => {
    expect(STARTER_COUNTRY_RULES.map((r) => r.countryCode)).toEqual(["BD", "TR"]);
    for (const r of STARTER_COUNTRY_RULES) {
      expect(r.requirements).toEqual(["carrierBl"]);
      expect(r.reviewed).toBe(false);
      expect(parseCountryRuleDraft(r).ok).toBe(true);
    }
  });
});

describe("regionName", () => {
  it("返回本地化国家名，未知代码回退为代码本身", () => {
    expect(regionName("BD", "en")).toMatch(/Bangladesh/);
    expect(regionName("TR", "zh")).toMatch(/土耳其|土耳其共和国|Türkiye/);
    expect(regionName("ZZ", "en")).toBeTruthy();
  });
});
```

**Step 2: 运行确认失败**

Run: `npm test -w @lc/core -- test/countryRules.test.ts`
Expected: FAIL，导出不存在。

**Step 3: 实现** `packages/core/src/countryRules.ts`

```ts
import type { Lang } from "./messages";

/** 可被机器核对的要求事项；其余内容写在自由备注里，只显示给人看 */
export type CountryRequirement = "carrierBl" | "fullSetBl" | "noTranshipment" | "confirmation";
export const COUNTRY_REQUIREMENTS: readonly CountryRequirement[] = ["carrierBl", "fullSetBl", "noTranshipment", "confirmation"];

export const REQUIREMENT_LABELS: Record<CountryRequirement, Record<Lang, string>> = {
  carrierBl: { zh: "必须船东单（承运人签发的提单）", en: "Carrier-issued bill of lading required" },
  fullSetBl: { zh: "需全套正本提单", en: "Full set of original bills of lading required" },
  noTranshipment: { zh: "禁止转运", en: "No transhipment" },
  confirmation: { zh: "建议保兑", en: "Confirmation recommended" },
};

export type CountryLevel = "notice" | "high";

export interface CountryRuleDraft {
  /** ISO 3166-1 alpha-2，大写；与开证行 BIC 第 5、6 位对应 */
  countryCode: string;
  level: CountryLevel;
  requirements: CountryRequirement[];
  note: string;
  enabled: boolean;
  /** 是否已由单证专业人员审核；未审核的提示会带“待审核”字样 */
  reviewed: boolean;
}

export interface CountryRule extends CountryRuleDraft {
  id: string;
}

const MAX_NOTE = 2000;

export function parseCountryRuleDraft(raw: unknown): { ok: true; draft: CountryRuleDraft } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "root" };
  const o = raw as Record<string, unknown>;
  const code = typeof o.countryCode === "string" ? o.countryCode.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(code)) return { ok: false, error: "countryCode" };
  if (o.level !== "notice" && o.level !== "high") return { ok: false, error: "level" };
  if (!Array.isArray(o.requirements) || !o.requirements.every((r) => COUNTRY_REQUIREMENTS.includes(r as CountryRequirement))) return { ok: false, error: "requirements" };
  if (typeof o.note !== "string" || o.note.length > MAX_NOTE) return { ok: false, error: "note" };
  if (typeof o.enabled !== "boolean") return { ok: false, error: "enabled" };
  if (typeof o.reviewed !== "boolean") return { ok: false, error: "reviewed" };
  return {
    ok: true,
    draft: {
      countryCode: code,
      level: o.level,
      requirements: [...new Set(o.requirements as CountryRequirement[])],
      note: o.note,
      enabled: o.enabled,
      reviewed: o.reviewed,
    },
  };
}

/** 起步清单：只放已经确认的内容，并标为未审核。其余由用户自行增补 */
export const STARTER_COUNTRY_RULES: CountryRuleDraft[] = [
  { countryCode: "BD", level: "notice", requirements: ["carrierBl"], note: "起步示例，待单证人员审核：该国信用证常要求提交船东单。", enabled: true, reviewed: false },
  { countryCode: "TR", level: "notice", requirements: ["carrierBl"], note: "起步示例，待单证人员审核：该国信用证常要求提交船东单。", enabled: true, reviewed: false },
];

/** 国家代码 → 本地化国家名；运行环境不支持或代码未知时回退为代码 */
export function regionName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([lang === "zh" ? "zh-Hans" : "en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
```

`packages/core/src/index.ts` 末尾加：`export * from "./countryRules";`

**Step 4: 运行确认通过**

Run: `npm test -w @lc/core -- test/countryRules.test.ts`
Expected: PASS。若 `regionName("TR","zh")` 因 ICU 数据不同返回了别的写法导致失败，把测试的正则放宽到实际返回值，**不要**改实现去迎合测试。

**Step 5: Commit**

```bash
git add packages/core/src/countryRules.ts packages/core/src/index.ts packages/core/test/countryRules.test.ts
git commit -m "feat(core): 国别规则模型、校验与起步清单"
```

---

### Task 3: 审证规则“国别风险提示”

**Files:**
- Create: `packages/core/src/rules/countryRisk.ts`
- Modify: `packages/core/src/catalog-docs.ts`（在 `DOC_CATALOG` 末尾追加条目）
- Modify: `packages/core/src/rules/titles.ts`
- Modify: `packages/core/src/rules/index.ts`
- Test: `packages/core/test/country-risk.test.ts`（新建）

**Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { buildCountryRiskRule, localizeFinding, parseMt700, runRules } from "../src";
import type { CountryRule } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const rule = (p: Partial<CountryRule> = {}): CountryRule => ({
  id: "r1", countryCode: "BD", level: "notice", requirements: ["carrierBl", "noTranshipment"], note: "测试备注", enabled: true, reviewed: false, ...p,
});
const lcOf = (bic?: string) => parseMt700(bic ? SAMPLE_MT700.replace(":27:1/1", `:27:1/1\n:52A:${bic}`) : SAMPLE_MT700);
const run = (rules: CountryRule[], lc = lcOf("TESTBDDHXXX")) => runRules([buildCountryRiskRule(rules)], { lc });

describe("LCR-COUNTRY-RISK", () => {
  it("命中国家时列出要求、备注与待审核状态（中英文）", () => {
    const { findings } = run([rule()]);
    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.code).toBe("country.hit");
    expect(f.severity).toBe("info");
    expect(f.stage).toBe("lc");
    const zh = localizeFinding(f, "zh").message;
    expect(zh).toContain("必须船东单");
    expect(zh).toContain("禁止转运");
    expect(zh).toContain("测试备注");
    expect(zh).toContain("待审核");
    expect(localizeFinding(f, "en").message).toContain("Carrier-issued");
  });
  it("高风险等级对应 risk；已审核不再带待审核字样", () => {
    const f = run([rule({ level: "high", reviewed: true })]).findings[0]!;
    expect(f.severity).toBe("risk");
    expect(localizeFinding(f, "zh").message).not.toContain("待审核");
  });
  it("国家不在表里：没有发现", () => {
    expect(run([rule()], lcOf("TESTUS33XXX")).findings).toEqual([]);
  });
  it("停用的规则不参与", () => {
    expect(run([rule({ enabled: false })]).findings).toEqual([]);
  });
  it("读不出开证行国家：提示未检查，而不是当作通过", () => {
    const f = run([rule()], lcOf()).findings[0]!;
    expect(f.code).toBe("country.unknown");
    expect(f.severity).toBe("info");
  });
  it("表里没有任何启用的规则：不出任何提示", () => {
    expect(run([], lcOf()).findings).toEqual([]);
  });
});
```

**Step 2: 运行确认失败**

Run: `npm test -w @lc/core -- test/country-risk.test.ts`
Expected: FAIL，`buildCountryRiskRule` 不存在。

**Step 3: 实现**

`packages/core/src/rules/countryRisk.ts`：

```ts
import { REQUIREMENT_LABELS, regionName, type CountryRule } from "../countryRules";
import { makeFinding } from "../messages";
import type { LcRule } from "../model";

export const COUNTRY_RISK_ID = "LCR-COUNTRY-RISK";

/** 审证：按开证行所在国家，把国别规则表里的要求列给用户。只是提醒或风险提示，不是单据不符点 */
export function buildCountryRiskRule(rules: CountryRule[]): LcRule {
  const active = rules.filter((r) => r.enabled);
  const clause = "Internal country policy";
  return {
    stage: "lc",
    id: COUNTRY_RISK_ID,
    clause,
    title: "国别风险提示",
    evaluate({ lc }) {
      if (active.length === 0) return [];
      if (!lc.issuingCountry) {
        return [
          makeFinding({
            ruleId: COUNTRY_RISK_ID,
            clause,
            severity: "info",
            code: "country.unknown",
            params: {},
            evidence: [{ document: "lc", field: "52A", value: lc.raw["52A"] ?? "" }],
          }),
        ];
      }
      return active
        .filter((r) => r.countryCode === lc.issuingCountry)
        .map((r) =>
          makeFinding({
            ruleId: COUNTRY_RISK_ID,
            clause,
            severity: r.level === "high" ? "risk" : "info",
            code: "country.hit",
            params: {
              country: r.countryCode,
              countryZh: regionName(r.countryCode, "zh"),
              countryEn: regionName(r.countryCode, "en"),
              reqZh: r.requirements.map((q) => REQUIREMENT_LABELS[q].zh).join("；") || "（未勾选具体要求）",
              reqEn: r.requirements.map((q) => REQUIREMENT_LABELS[q].en).join("; ") || "(no specific requirement ticked)",
              stateZh: r.reviewed ? "" : "（待审核）",
              stateEn: r.reviewed ? "" : " (pending review)",
              note: r.note,
            },
            evidence: [
              { document: "lc", field: "52A", value: lc.issuingBankBic ?? "" },
              { document: "manual", field: `country:${r.countryCode}`, value: r.note || r.requirements.join(",") },
            ],
          }),
        );
    },
  };
}
```

`catalog-docs.ts` 在 `DOC_CATALOG` 里追加（保持文件里现有的 `Entry` 写法）：

```ts
  "country.hit": {
    zh: { message: "开证行所在国家：{countryZh}（{country}）{stateZh}。该国的要求：{reqZh}。{note}", suggestion: "发运前对照这些要求逐项确认；国别规则由你们公司维护，可在“国别规则”中修改。" },
    en: { message: "Issuing bank country: {countryEn} ({country}){stateEn}. Requirements: {reqEn}. {note}", suggestion: "Check each requirement before shipping; the country rules are maintained by your company under “Country rules”." },
  },
  "country.unknown": {
    zh: { message: "未能从 52A 识别开证行所在国家，国别规则未检查", suggestion: "请人工确认开证行所在国家，并对照“国别规则”。" },
    en: { message: "The issuing bank country could not be read from field 52A, so country rules were not checked", suggestion: "Confirm the issuing bank country manually and compare it with the country rules." },
  },
```

`titles.ts` 的 `RULE_TITLES` 末尾追加：

```ts
  "LCR-COUNTRY-RISK": { zh: "国别风险提示", en: "Country risk notice" },
```

`rules/index.ts` 加：`export * from "./countryRisk";`（注意：该规则不放进 `allRules`，由存储层动态构建。）

**Step 4: 运行确认通过**

Run: `npm test -w @lc/core -- test/country-risk.test.ts` 与 `npm test -w @lc/core`
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/core/src packages/core/test/country-risk.test.ts
git commit -m "feat(core): 审证规则——国别风险提示"
```

---

### Task 4: 船东单条款识别与审单规则

**Files:**
- Modify: `packages/core/src/model.ts`（`TransportDocData`、`Evidence`——无需改，`transport` 已在联合类型里）
- Create: `packages/core/src/rules/carrierBl.ts`
- Modify: `packages/core/src/catalog-docs.ts`、`packages/core/src/rules/titles.ts`、`packages/core/src/rules/index.ts`
- Test: `packages/core/test/carrier-bl.test.ts`（新建）

**Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { buildCarrierBlRule, classifyIssuer, detectCarrierBlClause, localizeFinding, parseMt700, runRules } from "../src";
import type { CountryRule, Presentation } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const lcWith = (extra47A = "", bic?: string) =>
  parseMt700(
    SAMPLE_MT700.replace(":47A:+ALL DOCUMENTS IN ENGLISH", `:47A:+ALL DOCUMENTS IN ENGLISH${extra47A}`).replace(":27:1/1", bic ? `:27:1/1\n:52A:${bic}` : ":27:1/1"),
  );
const bdRule: CountryRule = { id: "r", countryCode: "BD", level: "notice", requirements: ["carrierBl"], note: "", enabled: true, reviewed: true };
const pres = (transport?: Presentation["transport"]): Presentation => ({ presentationDate: "2024-08-25", transport });

describe("detectCarrierBlClause", () => {
  it.each([
    "+B/L MUST BE ISSUED BY THE CARRIER OR SHIPOWNER",
    "+BILL OF LADING ISSUED BY SHIPOWNER ONLY",
    "+FORWARDER'S B/L NOT ACCEPTABLE",
    "+FREIGHT FORWARDER BILL OF LADING IS NOT ACCEPTED",
    "+HOUSE B/L NOT ALLOWED",
    "+SHIPOWNER'S BILL OF LADING REQUIRED",
  ])("识别：%s", (clause) => {
    const hit = detectCarrierBlClause(lcWith(`\n${clause}`));
    expect(hit?.field).toBe("47A");
    expect(hit?.snippet.length).toBeGreaterThan(0);
  });
  it("不误报", () => {
    expect(detectCarrierBlClause(lcWith())).toBeNull();
    expect(detectCarrierBlClause(lcWith("\n+FREIGHT PREPAID"))).toBeNull();
  });
});

describe("classifyIssuer", () => {
  it.each([
    ["Evergreen Marine as carrier", "carrier"],
    ["signed by the master", "carrier"],
    ["XYZ Logistics, freight forwarder", "forwarder"],
    ["ABC NVOCC", "forwarder"],
    ["Agent for the carrier", "agent"],
    ["", "unknown"],
    ["Some Co", "unknown"],
  ])("%s → %s", (text, kind) => expect(classifyIssuer(text)).toBe(kind));
});

describe("UCP600-20-CARRIER-BL", () => {
  const run = (lc: ReturnType<typeof lcWith>, p: Presentation | null, rules: CountryRule[] = [bdRule]) =>
    runRules([buildCarrierBlRule(rules)], { lc, presentation: p });

  it("没有任何来源要求：不出发现，也不影响其他规则", () => {
    expect(run(lcWith(), pres({ signingCapacity: "freight forwarder" })).findings).toEqual([]);
  });
  it("来源是国别规则：货代签发 → 疑点，并注明来源", () => {
    const { findings } = run(lcWith("", "TESTBDDHXXX"), pres({ issuerName: "ABC Logistics", signingCapacity: "as freight forwarder" }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe("carrierBl.forwarder");
    expect(findings[0]!.severity).toBe("doubt");
    expect(findings[0]!.stage).toBe("docs");
    expect(localizeFinding(findings[0]!, "zh").message).toContain("国别规则");
  });
  it("来源是信用证条款：承运人签发 → 通过", () => {
    const lc = lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER");
    expect(run(lc, pres({ signingCapacity: "as carrier" })).findings).toEqual([]);
    expect(localizeFinding(run(lc, pres({ signingCapacity: "agent for the carrier" })).findings[0]!, "zh").message).toContain("信用证条款");
  });
  it("代理或无法判断：需人工确认", () => {
    const lc = lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER");
    expect(run(lc, pres({ signingCapacity: "agent for the carrier" })).findings[0]!.code).toBe("carrierBl.confirm");
    expect(run(lc, pres({ shipmentDate: "2024-08-01" })).findings[0]!.code).toBe("carrierBl.confirm");
  });
  it("有要求但没有运输单据数据：记为未检查", () => {
    const r = run(lcWith("\n+B/L MUST BE ISSUED BY THE CARRIER"), pres());
    expect(r.findings).toEqual([]);
    expect(r.coverage.skipped).toContain("UCP600-20-CARRIER-BL");
  });
  it("国别规则停用或未勾选 carrierBl 时不触发", () => {
    const lc = lcWith("", "TESTBDDHXXX");
    expect(run(lc, pres({ signingCapacity: "forwarder" }), [{ ...bdRule, enabled: false }]).findings).toEqual([]);
    expect(run(lc, pres({ signingCapacity: "forwarder" }), [{ ...bdRule, requirements: ["noTranshipment"] }]).findings).toEqual([]);
  });
});
```

**Step 2: 运行确认失败**

Run: `npm test -w @lc/core -- test/carrier-bl.test.ts`
Expected: FAIL，导出不存在。

**Step 3: 实现**

`model.ts` 的 `TransportDocData` 里追加：

```ts
  /** 提单签发人名称，以及签章处的签发身份（as carrier / as agent for the carrier / master 等） */
  issuerName?: string;
  signingCapacity?: string;
```

`rules/carrierBl.ts`：

```ts
import { regionName, type CountryRule } from "../countryRules";
import { makeFinding } from "../messages";
import type { Evidence, LetterOfCredit, PresentationRule } from "../model";

export const CARRIER_BL_ID = "UCP600-20-CARRIER-BL";

/** 信用证里要求承运人 / 船东签发提单、或不接受货代提单的常见写法。模式都有长度上限，避免回溯过深 */
const CLAUSES: RegExp[] = [
  /issued by (?:the )?(?:carrier|ship ?owner|vessel owner|steamship company|shipping company)/i,
  /(?:ship ?owner|carrier|shipping company)(?:'s|s)? (?:own )?(?:bill|b\/l)/i,
  /(?:forwarders?|freight forwarders?|nvocc|non[- ]vessel)\W{0,3}(?:'s|s)?\W{0,3}(?:house )?(?:bills? of lading|b\/l)?.{0,40}not (?:be )?(?:acceptable|accepted|allowed|acceptable)/i,
  /not accept(?:able|ed)?.{0,40}(?:forwarders?|nvocc|house)/i,
  /house (?:bills? of lading|b\/l).{0,30}not/i,
];

export function detectCarrierBlClause(lc: LetterOfCredit): { field: "46A" | "47A"; snippet: string } | null {
  for (const field of ["46A", "47A"] as const) {
    const text = lc.raw[field];
    if (!text) continue;
    const flat = text.replace(/\s+/g, " ");
    for (const re of CLAUSES) {
      const m = re.exec(flat);
      if (m) return { field, snippet: flat.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20).trim() };
    }
  }
  return null;
}

export type IssuerKind = "carrier" | "forwarder" | "agent" | "unknown";

/** 按签发人 / 签发身份的文字做保守分类；只有明确出现承运人字样才算承运人 */
export function classifyIssuer(text: string): IssuerKind {
  if (/forwarders?|nvocc|non[- ]vessel/i.test(text)) return "forwarder";
  if (/agent/i.test(text)) return "agent";
  if (/\bcarrier\b|\bmaster\b|ship ?owner|\bowner\b/i.test(text)) return "carrier";
  return "unknown";
}

interface Source {
  zh: string;
  en: string;
  evidence: Evidence;
}

function sources(lc: LetterOfCredit, rules: CountryRule[]): Source[] {
  const out: Source[] = [];
  const clause = detectCarrierBlClause(lc);
  if (clause) out.push({ zh: "信用证条款", en: "L/C clause", evidence: { document: "lc", field: clause.field, value: clause.snippet } });
  const code = lc.issuingCountry;
  if (code && rules.some((r) => r.enabled && r.countryCode === code && r.requirements.includes("carrierBl"))) {
    out.push({
      zh: `国别规则（${regionName(code, "zh")}）`,
      en: `country rule (${regionName(code, "en")})`,
      evidence: { document: "manual", field: `country:${code}`, value: "carrierBl" },
    });
  }
  return out;
}

/** 审单：要求船东单（信用证条款或国别规则）时，核对提单的签发人 / 签发身份。结论最多是疑点，不判不符 */
export function buildCarrierBlRule(rules: CountryRule[]): PresentationRule {
  const clause = "UCP600 Art.20(a)";
  return {
    stage: "presentation",
    id: CARRIER_BL_ID,
    clause,
    title: "船东单（承运人签发提单）",
    // 没有任何要求时无需数据，直接通过；有要求但没有运输单据数据时记为「未检查」
    applicable: ({ lc, presentation }) => sources(lc, rules).length === 0 || !!presentation.transport,
    evaluate({ lc, presentation }) {
      const src = sources(lc, rules);
      if (src.length === 0) return [];
      const t = presentation.transport!;
      const issuer = [t.issuerName, t.signingCapacity].filter((s): s is string => !!s && s.trim() !== "").join(" / ");
      const kind = classifyIssuer(issuer);
      if (kind === "carrier") return [];
      return [
        makeFinding({
          ruleId: CARRIER_BL_ID,
          clause,
          severity: "doubt",
          code: kind === "forwarder" ? "carrierBl.forwarder" : "carrierBl.confirm",
          params: { sourceZh: src.map((s) => s.zh).join("、"), sourceEn: src.map((s) => s.en).join(", "), issuer: issuer || "—" },
          evidence: [...src.map((s) => s.evidence), { document: "transport", field: "issuer", value: issuer }],
        }),
      ];
    },
  };
}
```

`catalog-docs.ts` 追加：

```ts
  "carrierBl.forwarder": {
    zh: { message: "要求提交船东单（来源：{sourceZh}），但提单的签发人看起来是货代：{issuer}", suggestion: "货代提单（House B/L）可能被银行当作不符点。请改用船公司（承运人）签发的提单，或在发运前要求申请人修改该条款。" },
    en: { message: "A carrier-issued bill of lading is required (source: {sourceEn}), but the issuer looks like a forwarder: {issuer}", suggestion: "A forwarder (house) bill of lading may be refused by the bank. Use a bill of lading issued by the shipping line (carrier), or ask the applicant to amend the clause before shipment." },
  },
  "carrierBl.confirm": {
    zh: { message: "要求提交船东单（来源：{sourceZh}），但无法确认提单是否由承运人签发（当前记录：{issuer}）", suggestion: "请对照提单签章确认签发人和签发身份（as carrier / master 等），并把它们录入运输单据数据。" },
    en: { message: "A carrier-issued bill of lading is required (source: {sourceEn}), but it cannot be confirmed that the bill was issued by the carrier (recorded: {issuer})", suggestion: "Check the signature block of the bill of lading for the issuer and capacity (as carrier / master, etc.) and enter them in the transport document data." },
  },
```

`titles.ts` 追加：`"UCP600-20-CARRIER-BL": { zh: "船东单（承运人签发提单）", en: "Carrier-issued bill of lading" },`

`rules/index.ts` 加：`export * from "./carrierBl";`，并把 `RULESET_VERSION` 改为 `"builtin-0.3.0"`。

**Step 4: 运行确认通过**

Run: `npm test -w @lc/core -- test/carrier-bl.test.ts` 与 `npm test -w @lc/core`
Expected: PASS。若某条“识别”用例未命中，**先看真实措辞再调正则**，每加一条正则都要同时加一个“不误报”用例。

**Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 船东单条款识别与审单规则；规则集升至 0.3.0"
```

---

### Task 5: 运输单据的签发人字段进入抽取

**Files:**
- Modify: `packages/core/src/llm/extract.ts`
- Test: `packages/core/test/extract-text.test.ts`（在现有文件末尾追加 describe）；先看该文件里 `extractFields` 是怎么用假 `LlmClient` 的，照搬写法

**Step 1: 写失败的测试**（追加到现有测试文件，沿用其中假客户端的构造方式）

```ts
describe("运输单据的签发人字段", () => {
  it("抽取 issuerName 与 signingCapacity，并映射到 TransportDocData", async () => {
    const text = "BILL OF LADING\nCarrier: Evergreen Marine Corp.\nSigned for the Carrier, Evergreen Marine Corp. as carrier";
    const client = fakeClient({ fields: [
      { name: "issuerName", value: "Evergreen Marine Corp.", quote: "Evergreen Marine Corp." },
      { name: "signingCapacity", value: "as carrier", quote: "as carrier" },
    ] });
    const r = await extractFields(client, "transport", text);
    expect(r.rejected).toEqual([]);
    expect(toTransportData(r)).toMatchObject({ issuerName: "Evergreen Marine Corp.", signingCapacity: "as carrier" });
  });
});
```

（`fakeClient` 用该文件现有的辅助函数名；若没有，就按文件里已有用例的方式内联一个返回固定 JSON 的 `LlmClient`。）

**Step 2: 运行确认失败**

Run: `npm test -w @lc/core -- test/extract-text.test.ts`
Expected: FAIL，两个字段被判为 `outOfScope`。

**Step 3: 实现**

`extract.ts`：

```ts
  transport: { shipmentDate: "date", portOfLoading: "text", portOfDischarge: "text", issuerName: "text", signingCapacity: "text" },
```

`HINTS.transport` 末尾追加：

```ts
    "…; issuerName: the name of the party that issued the bill of lading (the carrier named at the signature block or letterhead); " +
    "signingCapacity: the capacity in which it was signed, copied as written (e.g. 'as carrier', 'as agent for the carrier', 'master', 'freight forwarder').",
```

（注意把上面第一行末尾的句号改成合适的分隔，保持提示语通顺。）

`toTransportData`：

```ts
  return {
    shipmentDate: f.shipmentDate?.value,
    portOfLoading: f.portOfLoading?.value,
    portOfDischarge: f.portOfDischarge?.value,
    issuerName: f.issuerName?.value,
    signingCapacity: f.signingCapacity?.value,
  };
```

**Step 4: 运行确认通过**

Run: `npm test -w @lc/core`
Expected: PASS。

**Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): 运输单据抽取增加签发人与签发身份"
```

---

### Task 6: 存储层——country_rules 表、起步清单、CRUD、接入 runCase

**Files:**
- Modify: `packages/storage/src/store.ts`
- Modify: `packages/storage/test/encryption.test.ts`（`PLAIN` 增加新表）
- Test: `packages/storage/test/country-rules.test.ts`（新建）

**Step 1: 写失败的测试**

```ts
import { describe, expect, it } from "vitest";
import { CaseStore } from "../src";

const LC = (bic?: string) => `${bic ? `:52A:${bic}\n` : ""}:20:LC1\n:32B:USD1000,00\n:59:SANDNES TRADING CO LTD\n:47A:+B/L MUST BE ISSUED BY THE CARRIER`;
const draft = { countryCode: "PK", level: "high" as const, requirements: ["carrierBl" as const], note: "n", enabled: true, reviewed: true };

describe("country_rules", () => {
  it("首次打开写入起步清单（孟加拉、土耳其，未审核）", () => {
    const s = new CaseStore();
    expect(s.listCountryRules().map((r) => [r.countryCode, r.reviewed])).toEqual([["BD", false], ["TR", false]]);
  });
  it("用户删光之后重新打开不会再次写入", () => {
    const s = new CaseStore();
    for (const r of s.listCountryRules()) s.deleteCountryRule(r.id);
    expect(s.listCountryRules()).toEqual([]);
    // 同一连接上再次触发种子逻辑（模拟重启）
    (s as unknown as { seedCountryRules(): void }).seedCountryRules();
    expect(s.listCountryRules()).toEqual([]);
  });
  it("增删改与审计", () => {
    const s = new CaseStore();
    const a = s.addCountryRule(draft);
    expect(s.listCountryRules().some((r) => r.id === a.id)).toBe(true);
    const b = s.updateCountryRule(a.id, { ...draft, level: "notice", note: "改" });
    expect(b).toMatchObject({ level: "notice", note: "改" });
    s.deleteCountryRule(a.id);
    expect(s.listCountryRules().some((r) => r.id === a.id)).toBe(false);
    expect(() => s.updateCountryRule("nope", draft)).toThrowError(expect.objectContaining({ code: "countryRule.notFound" }));
    expect(s.verifyAudit().ok).toBe(true);
  });
  it("runCase 使用当前国别规则：命中国家出现提示", () => {
    const s = new CaseStore();
    const c = s.createCase({ name: "t", lcText: LC("TESTBDDHXXX") });
    const run = s.runCase(c.id);
    expect(run.findings.some((f) => f.code === "country.hit")).toBe(true);
    expect(run.coverage.lcRules).toContain("LCR-COUNTRY-RISK");
  });
  it("runCase：停用规则后不再提示", () => {
    const s = new CaseStore();
    for (const r of s.listCountryRules()) s.updateCountryRule(r.id, { ...r, enabled: false });
    const c = s.createCase({ name: "t", lcText: LC("TESTBDDHXXX") });
    expect(s.runCase(c.id).findings.some((f) => f.code.startsWith("country."))).toBe(false);
  });
});
```

（`verifyAudit` 请以 store.ts 里实际的审计校验方法名为准——先 `grep -n "audit" packages/storage/src/store.ts` 确认；若名称不同，改测试里的调用。）

**Step 2: 运行确认失败**

Run: `npm test -w @lc/storage -- test/country-rules.test.ts`
Expected: FAIL，`listCountryRules is not a function`。

**Step 3: 实现**（`packages/storage/src/store.ts`）

1. 顶部 import 增加 `buildCarrierBlRule, buildCountryRiskRule, parseCountryRuleDraft, STARTER_COUNTRY_RULES`（来自 `@lc/core`）和类型 `CountryRule, CountryRuleDraft, CountryRequirement`。

2. `SCHEMA` 里在 `check_items` 之后加：

```sql
CREATE TABLE IF NOT EXISTS country_rules (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  level TEXT NOT NULL,
  requirements_json TEXT NOT NULL,
  note TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  reviewed INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

3. `SECRET_COLUMNS` 增加：`country_rules: ["requirements_json", "note"],`

4. 构造函数里 `this.initEncryption();` 之后加 `this.seedCountryRules();`

5. 方法（放在 `deleteCheckItem` / `requireItem` 附近）：

```ts
  /** 首次打开时写入起步清单；用 meta 标记，用户删光后不会再次出现 */
  private seedCountryRules(): void {
    if (this.getMeta("country_rules_seeded") === "1") return;
    this.tx(() => {
      for (const d of STARTER_COUNTRY_RULES) this.insertCountryRule(d);
      this.setMeta("country_rules_seeded", "1");
    });
  }

  private insertCountryRule(d: CountryRuleDraft): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO country_rules (id,country_code,level,requirements_json,note,enabled,reviewed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, d.countryCode, d.level, this.seal("country_rules", "requirements_json", JSON.stringify(d.requirements)), this.seal("country_rules", "note", d.note), d.enabled ? 1 : 0, d.reviewed ? 1 : 0, now, now);
    return id;
  }

  listCountryRules(): CountryRule[] {
    return (this.db.prepare("SELECT * FROM country_rules ORDER BY created_at, rowid").all() as Row[]).map((r) => ({
      id: r.id as string,
      countryCode: r.country_code as string,
      level: r.level as CountryRule["level"],
      requirements: this.openJson<CountryRequirement[]>("country_rules", "requirements_json", r.requirements_json) ?? [],
      note: this.open("country_rules", "note", r.note) ?? "",
      enabled: r.enabled === 1,
      reviewed: r.reviewed === 1,
    }));
  }

  /** 调用方须已用 parseCountryRuleDraft 校验 */
  addCountryRule(d: CountryRuleDraft): CountryRule {
    let id = "";
    this.tx(() => {
      id = this.insertCountryRule(d);
      this.audit("countryRule.add", null, { id, countryCode: d.countryCode });
    });
    return this.listCountryRules().find((r) => r.id === id)!;
  }

  updateCountryRule(id: string, d: CountryRuleDraft): CountryRule {
    this.requireCountryRule(id);
    this.tx(() => {
      this.db
        .prepare("UPDATE country_rules SET country_code=?,level=?,requirements_json=?,note=?,enabled=?,reviewed=?,updated_at=? WHERE id=?")
        .run(d.countryCode, d.level, this.seal("country_rules", "requirements_json", JSON.stringify(d.requirements)), this.seal("country_rules", "note", d.note), d.enabled ? 1 : 0, d.reviewed ? 1 : 0, new Date().toISOString(), id);
      this.audit("countryRule.update", null, { id, countryCode: d.countryCode });
    });
    return this.listCountryRules().find((r) => r.id === id)!;
  }

  deleteCountryRule(id: string): void {
    this.requireCountryRule(id);
    this.tx(() => {
      this.db.prepare("DELETE FROM country_rules WHERE id = ?").run(id);
      this.audit("countryRule.delete", null, { id });
    });
  }

  private requireCountryRule(id: string): void {
    if (!this.db.prepare("SELECT 1 FROM country_rules WHERE id = ?").get(id)) throw new AppError("countryRule.notFound", `国别规则不存在：${id}`, { id });
  }
```

（审计详情里只放 id 和国家代码，不放备注。`parseCountryRuleDraft` 在此处用不到，不用 import。）

6. `runCase` 里：

```ts
    const countryRules = this.listCountryRules();
    const result = runRules([...allRules, buildCountryRiskRule(countryRules), buildCarrierBlRule(countryRules), ...buildCustomRules(items)], { ... });
```

7. `encryption.test.ts` 的 `PLAIN` 增加：

```ts
      country_rules: ["id", "country_code", "level", "enabled", "reviewed", "created_at", "updated_at"],
```

（该测试的“每张加密表都应有数据”由起步清单满足，无需改 `populate`。）

**Step 4: 运行确认通过**

Run: `npm test -w @lc/storage`
Expected: PASS。若其他测试因规则数量增加（`coverage.checked` 长度等）而失败，逐个确认是预期变化后再更新期望值，并在提交说明里写明。

**Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): 国别规则表、起步清单与审查接入"
```

---

### Task 7: IPC 通道

**Files:**
- Modify: `apps/desktop/src/shared/api.ts`（接口、通道清单两处，再加类型导出）
- Modify: `apps/desktop/src/main/index.ts`（主进程处理）

**Step 1:** `shared/api.ts`

- 第 1 行 import 增加 `CountryRule, CountryRuleDraft`，并在第 5 行的 `export type {...}` 里一并导出。
- `LcInvokeApi` 里 `deleteCheckItem` 之后加：

```ts
  listCountryRules(): Promise<Result<CountryRule[]>>;
  saveCountryRule(id: string | null, draft: CountryRuleDraft): Promise<Result<CountryRule>>;
  deleteCountryRule(id: string): Promise<Result<null>>;
```

- 运行时通道名清单里 `"deleteCheckItem",` 之后加 `"listCountryRules", "saveCountryRule", "deleteCountryRule",`。

**Step 2:** `main/index.ts`

- 第 1 行 import 增加 `parseCountryRuleDraft, type CountryRuleDraft`。
- `validDraft` 之后加：

```ts
function validCountryDraft(raw: unknown): CountryRuleDraft {
  const r = parseCountryRuleDraft(raw);
  if (!r.ok) throw new AppError("countryRule.invalid", `国别规则内容无效：${r.error}`, { field: r.error });
  return r.draft;
}
```

- `handle("deleteCheckItem", ...)` 之后加：

```ts
  handle("listCountryRules", () => store.listCountryRules());
  handle("saveCountryRule", (_e, id, draft) => (id === null ? store.addCountryRule(validCountryDraft(draft)) : store.updateCountryRule(str(id, "id"), validCountryDraft(draft))));
  handle("deleteCountryRule", (_e, id) => store.deleteCountryRule(str(id, "id")));
```

- 若 `LOCKED_OK` 之类集合按通道名列了“锁定时可用”的白名单，**不要**把这三个加进去（锁定时本来就不该能改规则）。

**Step 3:** 验证

Run: `npm run typecheck`
Expected: 无错误。

**Step 4: Commit**

```bash
git add apps/desktop/src/shared/api.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): 国别规则 IPC 通道"
```

---

### Task 8: 界面——运输单据增加签发人 / 签发身份

**Files:**
- Modify: `apps/desktop/src/renderer/src/DocumentsPanel.tsx`（`DocFormValues`、`FORM_FIELD.transport`）
- Modify: `apps/desktop/src/renderer/src/CaseView.tsx`（`toPresentation`、`toFormValues`、运输单据表单项）
- Modify: `apps/desktop/src/renderer/src/i18n-rules.ts`（`docs.issuerName`、`docs.signingCapacity`、`field.issuerName`、`field.signingCapacity`，中英文各一份，放在现有 `docs.portOfLoading` / `field.portOfLoading` 旁边）

**Step 1:** `DocFormValues` 加 `issuerName?: string; signingCapacity?: string;`。`FORM_FIELD.transport` 改为：

```ts
  transport: { shipmentDate: "shipmentDate", portOfLoading: "portOfLoading", portOfDischarge: "portOfDischarge", issuerName: "issuerName", signingCapacity: "signingCapacity" },
```

**Step 2:** `CaseView.tsx`

`toPresentation` 的 `transport: group({...})` 里追加 `issuerName: blank(v.issuerName), signingCapacity: blank(v.signingCapacity)`；`toFormValues` 追加 `issuerName: p?.transport?.issuerName, signingCapacity: p?.transport?.signingCapacity`。

在 `portOfDischarge` 那个 `<Space align="start">` 之后、`<Divider ...sectionInsurance>` 之前加：

```tsx
                  <Space align="start">
                    <Form.Item name="issuerName" label={t("docs.issuerName")}>
                      <Input style={{ width: 280 }} />
                    </Form.Item>
                    <Form.Item name="signingCapacity" label={t("docs.signingCapacity")} extra={t("docs.signingCapacityHint")}>
                      <Input style={{ width: 280 }} />
                    </Form.Item>
                  </Space>
```

**Step 3:** `i18n-rules.ts` 文案

- zh：`"docs.issuerName": "提单签发人"`，`"docs.signingCapacity": "签发身份"`，`"docs.signingCapacityHint": "签章处的身份，如 as carrier / as agent for the carrier / master"`，`"field.issuerName": "提单签发人"`，`"field.signingCapacity": "签发身份"`
- en：`"docs.issuerName": "B/L issuer"`，`"docs.signingCapacity": "Signing capacity"`，`"docs.signingCapacityHint": "Capacity shown at the signature, e.g. as carrier / as agent for the carrier / master"`，`"field.issuerName": "B/L issuer"`，`"field.signingCapacity": "Signing capacity"`

**Step 4:** 验证

Run: `npm run typecheck` 与 `npm test -w @lc/desktop`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 运输单据表单增加签发人与签发身份"
```

---

### Task 9: 界面——“国别规则”管理窗口

**Files:**
- Create: `apps/desktop/src/renderer/src/CountryRulesModal.tsx`
- Create: `apps/desktop/src/renderer/src/i18n-country.ts`
- Modify: `apps/desktop/src/renderer/src/i18n-dicts.ts`（第 5 行附近 import；第 152 行 `DICTS` 里合并 `zhCountry` / `enCountry`）
- Modify: `apps/desktop/src/renderer/src/App.tsx`（按钮、状态、挂载，仿照 `KnowledgeModal` 的 3 处：import、`useState`、按钮、`<KnowledgeModal .../>`）

**Step 1:** `i18n-country.ts`

```ts
/** 国别规则管理窗口文案 */
export const zhCountry: Record<string, string> = {
  "btn.country": "国别规则",
  "country.title": "国别规则",
  "country.intro": "按开证行所在国家（取自 52A 的 BIC）提醒该国的特殊要求。内容由你们公司维护；起步清单只是示例，请由单证人员审核后再标为“已审核”。",
  "country.add": "新增国家",
  "country.col.country": "国家",
  "country.col.level": "等级",
  "country.col.requirements": "要求事项",
  "country.col.note": "备注与来源",
  "country.col.enabled": "启用",
  "country.col.reviewed": "已审核",
  "country.level.notice": "提醒",
  "country.level.high": "高风险",
  "country.req.carrierBl": "必须船东单",
  "country.req.fullSetBl": "需全套正本提单",
  "country.req.noTranshipment": "禁止转运",
  "country.req.confirmation": "建议保兑",
  "country.form.code": "国家代码（两位字母，如 BD）",
  "country.form.codeInvalid": "请输入两位字母的国家代码",
  "country.form.level": "提示等级",
  "country.form.requirements": "要求事项",
  "country.form.note": "备注与来源",
  "country.deleteConfirm": "删除该国家的规则？",
  "country.saved": "已保存",
};
export const enCountry: Record<string, string> = {
  "btn.country": "Country rules",
  "country.title": "Country rules",
  "country.intro": "Reminds you of country-specific requirements based on the issuing bank's country (taken from the BIC in field 52A). Your company maintains the content; the starter list is only an example — have a documentary specialist review it before marking it reviewed.",
  "country.add": "Add country",
  "country.col.country": "Country",
  "country.col.level": "Level",
  "country.col.requirements": "Requirements",
  "country.col.note": "Note and source",
  "country.col.enabled": "Enabled",
  "country.col.reviewed": "Reviewed",
  "country.level.notice": "Notice",
  "country.level.high": "High risk",
  "country.req.carrierBl": "Carrier-issued B/L required",
  "country.req.fullSetBl": "Full set of original B/L",
  "country.req.noTranshipment": "No transhipment",
  "country.req.confirmation": "Confirmation recommended",
  "country.form.code": "Country code (two letters, e.g. BD)",
  "country.form.codeInvalid": "Enter a two-letter country code",
  "country.form.level": "Level",
  "country.form.requirements": "Requirements",
  "country.form.note": "Note and source",
  "country.deleteConfirm": "Delete the rules for this country?",
  "country.saved": "Saved",
};
```

`i18n-dicts.ts`：`import { enCountry, zhCountry } from "./i18n-country";`，`DICTS` 的 zh 末尾加 `...zhCountry`、en 末尾加 `...enCountry`。

**Step 2:** `CountryRulesModal.tsx`（沿用 `KnowledgeModal` 的 `useI18n`、`AntApp.useApp`、`window.lc.*` + `errorText` 写法；先打开 `KnowledgeModal.tsx` 看它如何处理 `Result`，保持一致）

```tsx
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { COUNTRY_REQUIREMENTS, regionName, type CountryRequirement } from "@lc/core";
import { App as AntApp, Alert, Button, Checkbox, Form, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { CountryRule, CountryRuleDraft } from "../../shared/api";
import { useI18n } from "./i18n";

interface Props {
  open: boolean;
  onClose(): void;
}

const EMPTY: CountryRuleDraft = { countryCode: "", level: "notice", requirements: [], note: "", enabled: true, reviewed: false };

export default function CountryRulesModal({ open, onClose }: Props) {
  const { t, lang, errorText } = useI18n();
  const { message } = AntApp.useApp();
  const [rules, setRules] = useState<CountryRule[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; draft: CountryRuleDraft } | null>(null);
  const [form] = Form.useForm<CountryRuleDraft>();

  const load = useCallback(async () => {
    const r = await window.lc.listCountryRules();
    if (r.ok) setRules(r.data);
    else message.error(errorText(r));
  }, [message, errorText]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (editing) form.setFieldsValue(editing.draft);
  }, [editing, form]);

  const save = async () => {
    const draft = await form.validateFields();
    const r = await window.lc.saveCountryRule(editing!.id, { ...EMPTY, ...draft, countryCode: draft.countryCode.trim().toUpperCase() });
    if (!r.ok) return void message.error(errorText(r));
    message.success(t("country.saved"));
    setEditing(null);
    await load();
  };

  const patch = async (rule: CountryRule, change: Partial<CountryRuleDraft>) => {
    const { id, ...draft } = rule;
    const r = await window.lc.saveCountryRule(id, { ...draft, ...change });
    if (!r.ok) message.error(errorText(r));
    await load();
  };

  const remove = async (id: string) => {
    const r = await window.lc.deleteCountryRule(id);
    if (!r.ok) message.error(errorText(r));
    await load();
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={960} title={t("country.title")} destroyOnHidden>
      <Alert type="info" showIcon message={t("country.intro")} style={{ marginBottom: 12 }} />
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => { form.resetFields(); setEditing({ id: null, draft: EMPTY }); }}>
        {t("country.add")}
      </Button>
      <Table<CountryRule>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rules}
        columns={[
          { title: t("country.col.country"), render: (_, r) => `${regionName(r.countryCode, lang)}（${r.countryCode}）` },
          { title: t("country.col.level"), width: 90, render: (_, r) => <Tag color={r.level === "high" ? "red" : "blue"}>{t(`country.level.${r.level}`)}</Tag> },
          { title: t("country.col.requirements"), render: (_, r) => r.requirements.map((q) => <Tag key={q}>{t(`country.req.${q}`)}</Tag>) },
          { title: t("country.col.note"), dataIndex: "note", ellipsis: true },
          { title: t("country.col.enabled"), width: 80, render: (_, r) => <Switch checked={r.enabled} onChange={(v) => void patch(r, { enabled: v })} /> },
          { title: t("country.col.reviewed"), width: 90, render: (_, r) => <Switch checked={r.reviewed} onChange={(v) => void patch(r, { reviewed: v })} /> },
          {
            title: "",
            width: 90,
            render: (_, r) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => { const { id, ...draft } = r; setEditing({ id, draft }); }} />
                <Popconfirm title={t("country.deleteConfirm")} onConfirm={() => void remove(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal open={editing !== null} onCancel={() => setEditing(null)} onOk={() => void save()} title={t("country.title")} destroyOnHidden forceRender>
        <Form form={form} layout="vertical" initialValues={EMPTY}>
          <Form.Item name="countryCode" label={t("country.form.code")} rules={[{ required: true, pattern: /^[A-Za-z]{2}$/, message: t("country.form.codeInvalid") }]}>
            <Input maxLength={2} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="level" label={t("country.form.level")}>
            <Select style={{ width: 160 }} options={(["notice", "high"] as const).map((v) => ({ value: v, label: t(`country.level.${v}`) }))} />
          </Form.Item>
          <Form.Item name="requirements" label={t("country.form.requirements")}>
            <Checkbox.Group options={COUNTRY_REQUIREMENTS.map((q: CountryRequirement) => ({ value: q, label: t(`country.req.${q}`) }))} />
          </Form.Item>
          <Form.Item name="note" label={t("country.form.note")}>
            <Input.TextArea rows={3} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked" hidden><Switch /></Form.Item>
          <Form.Item name="reviewed" valuePropName="checked" hidden><Switch /></Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
}
```

（实现时以 `KnowledgeModal.tsx` 里 `errorText`、`t` 的真实签名为准；如果 `errorText` 接受的是错误对象而不是整个 `Result`，按它的用法调整。`t(\`country.level.${...}\`)` 若 `t` 的键类型是字面量联合，则改成显式映射表。）

**Step 3:** `App.tsx`：`import CountryRulesModal from "./CountryRulesModal";`，`const [countryOpen, setCountryOpen] = useState(false);`，在知识库按钮之后加：

```tsx
          <Button icon={<GlobalOutlined />} block style={{ marginTop: 8 }} onClick={() => setCountryOpen(true)}>
            {t("btn.country")}
          </Button>
```

（`GlobalOutlined` 加到该文件现有的 `@ant-design/icons` import 里。）并在 `<KnowledgeModal .../>` 之后加 `<CountryRulesModal open={countryOpen} onClose={() => setCountryOpen(false)} />`。

**Step 4:** 验证

Run: `npm run typecheck` 与 `npm test`
Expected: PASS。

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 国别规则管理窗口"
```

---

### Task 10: 端到端自检、文档与整体验证

**Files:**
- Modify: `apps/desktop/src/main/index.ts` 里的冒烟自检（约 L480–830，仿照知识库那段的写法，在其后追加一段）
- Modify: `README.md`（功能列表加一条；“当前状态与限制”里把规则数量更新为实际值；说明国别规则起步清单未经审核）
- Modify: `docs/deployment.md`（如有“数据与备份”一节，注明新增表 `country_rules` 随数据库一起备份）

**Step 1:** 冒烟自检里追加：

1. 用带 `:52A:TESTBDDHXXX` 的合成 MT700 建案，`runCase`，断言存在 `country.hit`，且 `ruleId === "LCR-COUNTRY-RISK"`。
2. `saveCountryRule(null, {countryCode:"zz", …})` 返回 ok 且 `countryCode === "ZZ"`；`saveCountryRule(null, {countryCode:"ZZZ", …})` 返回 `countryRule.invalid`。
3. 保存交单数据，运输单据带 `signingCapacity: "freight forwarder"`，信用证 47A 含 “B/L MUST BE ISSUED BY THE CARRIER”，`runCase` 后断言出现 `carrierBl.forwarder`。
4. 读磁盘字节，断言备注文字不以明文出现（与现有加密自检同一做法）。

**Step 2:** 运行全部验证

Run: `npm run typecheck && npm test && npm run smoke`
Expected: 全部通过。任何一项失败先查原因，不要放宽断言。

**Step 3:** 文档更新后

Run: `git diff --stat`
Expected: 只有上述文件。

**Step 4:** 重新打包并实测（可选，用户确认后再发布）

Run: `npm run dist`（网络不通时先设置 README 里的镜像环境变量）
Expected: 生成 `apps/desktop/release/LCCompliance-Setup-<版本>.exe`。发布新版本需先征得用户同意，并同步版本号。

**Step 5: Commit**

```bash
git add -A
git commit -m "test/docs: 国别规则与船东单端到端自检及文档"
```

---

## 完成标准

- `npm run typecheck`、`npm test`、`npm run smoke` 全部通过。
- 带 BD / TR 的 52A 信用证，审证结果出现“国别风险提示”，并带“待审核”字样；读不出国家时显示“未检查”提示而不是静默通过。
- 信用证 47A 写明承运人签发提单、或国别规则勾选“必须船东单”时，货代签发的提单被列为疑点，承运人签发则无发现，无法确认则提示人工核对。
- 国别规则可在界面增删改、启停、标记已审核；删光后重启不会再出现起步清单。
- 数据库里国别规则的备注与要求以密文存放，审计链完整。
