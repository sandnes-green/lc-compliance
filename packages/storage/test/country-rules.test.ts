import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CaseStore } from "../src";

const LC = (bic?: string) => `${bic ? `:52A:${bic}\n` : ""}:20:LC1\n:32B:USD1000,00\n:59:SANDNES TRADING CO LTD\n:47A:+B/L MUST BE ISSUED BY THE CARRIER`;
const draft = { countryCode: "PK", level: "high" as const, requirements: ["carrierBl" as const], note: "n", enabled: true, reviewed: true };

describe("country_rules", () => {
  it("首次打开写入起步清单（孟加拉、土耳其，未审核）", () => {
    const s = new CaseStore();
    expect(s.listCountryRules().map((r) => [r.countryCode, r.reviewed])).toEqual([["BD", false], ["TR", false]]);
  });
  it("用户删光之后重新打开（文件库）不会再次写入", () => {
    const dir = mkdtempSync(join(tmpdir(), "lc-cr-"));
    const file = join(dir, "t.db");
    try {
      const a = new CaseStore(file);
      for (const r of a.listCountryRules()) a.deleteCountryRule(r.id);
      expect(a.listCountryRules()).toEqual([]);
      a.close();
      const b = new CaseStore(file);
      expect(b.listCountryRules()).toEqual([]);
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("文件库重复打开：起步清单只写一次，数据保留", () => {
    const dir = mkdtempSync(join(tmpdir(), "lc-cr-"));
    const file = join(dir, "t.db");
    try {
      const a = new CaseStore(file);
      a.addCountryRule(draft);
      a.close();
      const b = new CaseStore(file);
      expect(b.listCountryRules().map((r) => r.countryCode)).toEqual(["BD", "TR", "PK"]);
      b.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(s.verifyAudit()).toBeNull();
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
  it("审计只记非敏感字段，update 带 noteChanged，备注原文不进任何审计详情", () => {
    const s = new CaseStore();
    const a = s.addCountryRule({ ...draft, note: "NOTE-SECRET-1234" });
    s.updateCountryRule(a.id, { ...draft, level: "notice", enabled: false, note: "NOTE-SECRET-1234" });
    s.updateCountryRule(a.id, { ...draft, note: "NOTE-SECRET-5678" });
    s.deleteCountryRule(a.id);
    const log = s.listAudit().filter((x) => x.action.startsWith("countryRule."));
    expect(log.map((x) => x.action)).toEqual(["countryRule.add", "countryRule.update", "countryRule.update", "countryRule.delete"]);
    const base = { id: a.id, countryCode: "PK", requirements: ["carrierBl"] };
    expect(log[0]!.detail).toEqual({ ...base, level: "high", enabled: true, reviewed: true });
    expect(log[1]!.detail).toEqual({ ...base, level: "notice", enabled: false, reviewed: true, noteChanged: false });
    expect(log[2]!.detail).toEqual({ ...base, level: "high", enabled: true, reviewed: true, noteChanged: true });
    for (const e of s.listAudit()) expect(JSON.stringify(e.detail)).not.toContain("NOTE-SECRET");
    expect(s.verifyAudit()).toBeNull();
  });
});
