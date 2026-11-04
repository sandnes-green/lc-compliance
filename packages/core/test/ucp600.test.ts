import { describe, expect, it } from "vitest";
import { invoiceAmount, latestShipment, parseMt700, presentationPeriod, runRules, ucp600Rules } from "../src";
import type { CaseContext, Presentation } from "../src";
import { SAMPLE_MT700 } from "./fixtures";

const lc = parseMt700(SAMPLE_MT700);
const ctx = (p: Partial<Presentation> = {}): CaseContext => ({
  lc,
  presentation: {
    presentationDate: "2024-08-25",
    invoice: { currency: "USD", amount: 100000 },
    transport: { shipmentDate: "2024-08-10" },
    ...p,
  },
});

describe("交单期 14(c)", () => {
  it("期限内通过", () => {
    expect(presentationPeriod.evaluate(ctx())).toEqual([]);
  });
  it("恰好第 21 天通过（边界）", () => {
    expect(presentationPeriod.evaluate(ctx({ presentationDate: "2024-08-31" }))).toEqual([]);
  });
  it("第 22 天为不符点", () => {
    const f = presentationPeriod.evaluate(ctx({ presentationDate: "2024-09-01" }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("discrepancy");
    expect(f[0]!.message).toContain("晚了 1 天");
  });
  it("超过有效期单独报出", () => {
    const f = presentationPeriod.evaluate(ctx({ presentationDate: "2024-10-01", transport: { shipmentDate: "2024-09-25" } }));
    expect(f.map((x) => x.clause)).toEqual(["UCP600 Art.6(d)"]);
  });
  it("缺少装运日期时提示疑点而不是静默通过", () => {
    const f = presentationPeriod.evaluate(ctx({ transport: {} }));
    expect(f[0]!.severity).toBe("doubt");
  });
});

describe("发票金额 18/30", () => {
  it("等于 L/C 金额通过", () => {
    expect(invoiceAmount.evaluate(ctx())).toEqual([]);
  });
  it("在 5% 上浮内通过（边界 105000）", () => {
    expect(invoiceAmount.evaluate(ctx({ invoice: { currency: "USD", amount: 105000 } }))).toEqual([]);
  });
  it("超出上浮 1 分钱即不符", () => {
    const f = invoiceAmount.evaluate(ctx({ invoice: { currency: "USD", amount: 105000.01 } }));
    expect(f).toHaveLength(1);
  });
  it("币种不一致", () => {
    const f = invoiceAmount.evaluate(ctx({ invoice: { currency: "EUR", amount: 1000 } }));
    expect(f[0]!.clause).toContain("18(a)(iii)");
  });
  it("无 39A 时不允许超额", () => {
    const noTol = { ...lc, tolerance: undefined };
    const f = invoiceAmount.evaluate({ lc: noTol, presentation: ctx({ invoice: { currency: "USD", amount: 100000.01 } }).presentation });
    expect(f).toHaveLength(1);
  });
});

describe("最迟装运日", () => {
  it("当天装运通过（边界）", () => {
    expect(latestShipment.evaluate(ctx({ transport: { shipmentDate: "2024-08-20" } }))).toEqual([]);
  });
  it("迟装为不符点", () => {
    const f = latestShipment.evaluate(ctx({ transport: { shipmentDate: "2024-08-21" } }));
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence.map((e) => e.field)).toEqual(["shipmentDate", "44C"]);
  });
  it("缺数据时由交单期规则负责提示，本规则不重复报", () => {
    expect(latestShipment.evaluate(ctx({ transport: {} }))).toEqual([]);
  });
});

describe("runRules", () => {
  it("汇总并按严重级别排序，规则异常不丢失", () => {
    const bad = { stage: "lc" as const, id: "BOOM", clause: "-", title: "-", evaluate:() => { throw new Error("x"); } };
    const r = runRules([bad, ...ucp600Rules], ctx({ presentationDate: "2024-09-15", transport: { shipmentDate: "2024-08-21" } }));
    expect(r.errors).toEqual([{ ruleId: "BOOM", message: "x" }]);
    expect(r.findings.map((f) => f.ruleId)).toEqual(["UCP600-14C-PRESENTATION", "UCP600-20-LATEST-SHIPMENT"]);
  });
});
