import { addDays, diffDays } from "../dates";
import { makeFinding } from "../messages";
import type { Finding, PresentationRule } from "../model";

const cents = (n: number) => Math.round(n * 100);

/** UCP600 第 14 条 c 款：交单不得晚于装运日后 21 个日历日（或 L/C 规定期限），且不得晚于有效期 */
export const presentationPeriod: PresentationRule = {
  stage: "presentation",
  id: "UCP600-14C-PRESENTATION",
  clause: "UCP600 Art.14(c), Art.6(d)",
  title: "交单期与有效期",
  evaluate({ lc, presentation: p }) {
    const out: Finding[] = [];
    const days = lc.presentationDays ?? 21;

    if (lc.expiryDate && p.presentationDate > lc.expiryDate) {
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: "UCP600 Art.6(d)",
          severity: "discrepancy",
          code: "presentation.expired",
          params: { presentationDate: p.presentationDate, expiryDate: lc.expiryDate },
          evidence: [{ document: "lc", field: "31D", value: lc.expiryDate }],
        }),
      );
    }

    const ship = p.transport?.shipmentDate;
    if (ship) {
      const deadline = addDays(ship, days);
      if (p.presentationDate > deadline) {
        out.push(
          makeFinding({
            ruleId: this.id,
            clause: this.clause,
            severity: "discrepancy",
            code: "presentation.stale",
            params: { presentationDate: p.presentationDate, shipmentDate: ship, days, deadline, late: diffDays(p.presentationDate, deadline) },
            evidence: [
              { document: "transport", field: "shipmentDate", value: ship },
              ...(lc.presentationDays ? [{ document: "lc" as const, field: "48", value: String(days) }] : []),
            ],
          }),
        );
      }
    } else {
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: this.clause,
          severity: "doubt",
          code: "presentation.noShipmentDate",
          params: {},
          evidence: [],
        }),
      );
    }
    return out;
  },
};

/** UCP600 第 18 条 a 款 / 第 30 条：发票币种须与 L/C 一致，金额不得超过 L/C 金额（含 39A 允许的上浮） */
export const invoiceAmount: PresentationRule = {
  stage: "presentation",
  id: "UCP600-18-INVOICE-AMOUNT",
  clause: "UCP600 Art.18(a), Art.30(b)",
  title: "发票币种与金额",
  applicable: ({ presentation: p }) => p.invoice?.amount !== undefined || p.invoice?.currency !== undefined,
  evaluate({ lc, presentation: p }) {
    const inv = p.invoice;
    if (!inv) return [];
    const out: Finding[] = [];

    if (inv.currency && inv.currency !== lc.currency) {
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: "UCP600 Art.18(a)(iii)",
          severity: "discrepancy",
          code: "invoice.currencyMismatch",
          params: { invoiceCurrency: inv.currency, lcCurrency: lc.currency },
          evidence: [
            { document: "invoice", field: "currency", value: inv.currency },
            { document: "lc", field: "32B", value: lc.currency },
          ],
        }),
      );
    }

    if (inv.amount !== undefined) {
      const plus = lc.tolerance?.plus ?? 0;
      const max = (lc.amount * (100 + plus)) / 100;
      if (cents(inv.amount) > cents(max)) {
        out.push(
          makeFinding({
            ruleId: this.id,
            clause: this.clause,
            severity: "discrepancy",
            code: "invoice.amountExceeded",
            params: { amount: inv.amount, max, lcAmount: lc.amount, plus },
            evidence: [
              { document: "invoice", field: "amount", value: String(inv.amount) },
              { document: "lc", field: "32B", value: String(lc.amount) },
              ...(lc.tolerance
                ? [{ document: "lc" as const, field: "39A", value: `${lc.tolerance.plus}/${lc.tolerance.minus}` }]
                : []),
            ],
          }),
        );
      }
    }
    return out;
  },
};

/** UCP600 第 14 条 / 第 20 条：装运日期不得晚于 44C 规定的最迟装运日 */
export const latestShipment: PresentationRule = {
  stage: "presentation",
  id: "UCP600-20-LATEST-SHIPMENT",
  clause: "UCP600 Art.14(d), Art.20(a)(ii)",
  title: "最迟装运日",
  applicable: ({ lc, presentation: p }) => lc.latestShipmentDate !== undefined && p.transport?.shipmentDate !== undefined,
  evaluate({ lc, presentation: p }) {
    const ship = p.transport?.shipmentDate;
    if (!lc.latestShipmentDate || !ship) return [];
    if (ship <= lc.latestShipmentDate) return [];
    return [
      makeFinding({
        ruleId: this.id,
        clause: this.clause,
        severity: "discrepancy",
        code: "shipment.late",
        params: { shipmentDate: ship, latest: lc.latestShipmentDate, late: diffDays(ship, lc.latestShipmentDate) },
        evidence: [
          { document: "transport", field: "shipmentDate", value: ship },
          { document: "lc", field: "44C", value: lc.latestShipmentDate },
        ],
      }),
    ];
  },
};

export const ucp600Rules: PresentationRule[] = [presentationPeriod, invoiceAmount, latestShipment];
