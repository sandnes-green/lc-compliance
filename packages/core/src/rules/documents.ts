import { makeFinding } from "../messages";
import type { Evidence, Finding, PresentationRule } from "../model";
import { compareGoods, compareNames, isGenericPort, portMatches } from "../text";

const cents = (n: number) => Math.round(n * 100);

/** 数量、规格、型号一类的标识：含数字，或只有 1-2 个字符 */
const isIdentifier = (w: string) => /\d/.test(w) || w.length <= 2;

/** UCP600 第 18 条 a 款：发票须由受益人出具，并以申请人为抬头 */
export const invoiceParties: PresentationRule = {
  stage: "presentation",
  id: "UCP600-18A-INVOICE-PARTIES",
  clause: "UCP600 Art.18(a)(i)-(ii)",
  title: "发票出具人与抬头",
  applicable: ({ lc, presentation: p }) =>
    (!!p.invoice?.sellerName && !!lc.beneficiaryName) || (!!p.invoice?.buyerName && !!lc.applicantName),
  evaluate({ lc, presentation: p }) {
    const out: Finding[] = [];
    const check = (
      docName: string | undefined,
      lcName: string | undefined,
      field: "59" | "50",
      docField: "sellerName" | "buyerName",
      prefix: "seller" | "buyer",
      clause: string,
    ) => {
      if (!docName || !lcName) return;
      const m = compareNames(docName, lcName);
      if (m === "same") return;
      const evidence: Evidence[] = [
        { document: "invoice", field: docField, value: docName },
        { document: "lc", field, value: lcName },
      ];
      out.push(
        makeFinding({
          ruleId: this.id,
          clause,
          severity: m === "close" ? "doubt" : "discrepancy",
          code: `invoice.${prefix}${m === "close" ? "Close" : "Mismatch"}`,
          params: { docName, lcName },
          evidence,
        }),
      );
    };
    check(p.invoice?.sellerName, lc.beneficiaryName, "59", "sellerName", "seller", "UCP600 Art.18(a)(i)");
    check(p.invoice?.buyerName, lc.applicantName, "50", "buyerName", "buyer", "UCP600 Art.18(a)(ii)");
    return out;
  },
};

/** UCP600 第 18 条 c 款：发票货物描述必须与信用证相符（可有额外说明，但不能缺项或矛盾） */
export const goodsDescription: PresentationRule = {
  stage: "presentation",
  id: "UCP600-18C-GOODS",
  clause: "UCP600 Art.18(c), Art.14(d)",
  title: "发票货物描述",
  applicable: ({ lc, presentation: p }) => !!lc.goodsDescription?.trim() && !!p.invoice?.goodsDescription?.trim(),
  evaluate({ lc, presentation: p }) {
    const lcText = lc.goodsDescription!;
    const docText = p.invoice!.goodsDescription!;
    const { coverage, missing } = compareGoods(lcText, docText);
    if (missing.length === 0) return [];
    const evidence: Evidence[] = [
      { document: "invoice", field: "goodsDescription", value: docText },
      { document: "lc", field: "45A", value: lcText },
    ];
    return [
      makeFinding({
        ruleId: this.id,
        clause: this.clause,
        // 缺失的是普通词且比例小，多半是措辞差异，交人工；
        // 缺失较多，或缺的是标识类词（含数字的数量/规格，或 X、Y 这样的型号字母），按不符点处理
        severity: coverage >= 0.8 && !missing.some(isIdentifier) ? "doubt" : "discrepancy",
        code: "invoice.goodsMismatch",
        params: { missing: missing.join(", "), percent: Math.round(coverage * 100) },
        evidence,
      }),
    ];
  },
};

/** 信用证对保险金额另有百分比要求时取其值，否则按 UCP600 第 28 条 f 款 ii 的 110% */
function requiredInsurancePercent(lc: { documentsRequired?: string; additionalConditions?: string }): number {
  const text = `${lc.documentsRequired ?? ""}\n${lc.additionalConditions ?? ""}`.toUpperCase();
  const m = /INSUR[A-Z]*[^+]{0,200}?(\d{2,3})\s*(?:PCT|PERCENT|%)/.exec(text);
  const pct = m ? Number(m[1]) : NaN;
  return pct >= 100 && pct <= 200 ? pct : 110;
}

/** UCP600 第 28 条：保险单据的币种、金额、日期 */
export const insuranceCover: PresentationRule = {
  stage: "presentation",
  id: "UCP600-28-INSURANCE",
  clause: "UCP600 Art.28(e), Art.28(f)",
  title: "保险单据币种、金额与日期",
  applicable: ({ presentation: p }) => !!p.insurance && (p.insurance.amount !== undefined || !!p.insurance.currency || !!p.insurance.date),
  evaluate({ lc, presentation: p }) {
    const ins = p.insurance!;
    const out: Finding[] = [];

    if (ins.currency && ins.currency !== lc.currency) {
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: "UCP600 Art.28(f)(i)",
          severity: "discrepancy",
          code: "insurance.currencyMismatch",
          params: { insCurrency: ins.currency, lcCurrency: lc.currency },
          evidence: [
            { document: "insurance", field: "currency", value: ins.currency },
            { document: "lc", field: "32B", value: lc.currency },
          ],
        }),
      );
    }

    if (ins.amount !== undefined) {
      const base = p.invoice?.amount;
      if (base === undefined) {
        out.push(
          makeFinding({
            ruleId: this.id,
            clause: "UCP600 Art.28(f)(ii)",
            severity: "doubt",
            code: "insurance.needInvoiceAmount",
            params: {},
            evidence: [{ document: "insurance", field: "amount", value: String(ins.amount) }],
          }),
        );
      } else {
        const percent = requiredInsurancePercent(lc);
        const required = (base * percent) / 100;
        if (cents(ins.amount) < cents(required)) {
          const termKnown = /\bC(IF|IP)\b/.test((lc.goodsDescription ?? "").toUpperCase());
          out.push(
            makeFinding({
              ruleId: this.id,
              clause: "UCP600 Art.28(f)(ii)",
              // 只有 CIF/CIP 才能确定由受益人投保且按发票值计算；其他贸易术语交人工判断
              severity: termKnown ? "discrepancy" : "doubt",
              code: termKnown ? "insurance.amountShort" : "insurance.amountShortUnknownTerm",
              params: { amount: ins.amount, required: Math.round(required * 100) / 100, percent, base },
              evidence: [
                { document: "insurance", field: "amount", value: String(ins.amount) },
                { document: "invoice", field: "amount", value: String(base) },
              ],
            }),
          );
        }
      }
    }

    const ship = p.transport?.shipmentDate;
    if (ins.date && ship && ins.date > ship) {
      out.push(
        makeFinding({
          ruleId: this.id,
          clause: "UCP600 Art.28(e)",
          severity: "discrepancy",
          code: "insurance.dateLate",
          params: { insuranceDate: ins.date, shipmentDate: ship },
          evidence: [
            { document: "insurance", field: "date", value: ins.date },
            { document: "transport", field: "shipmentDate", value: ship },
          ],
        }),
      );
    }
    return out;
  },
};

/** UCP600 第 20 条 a 款 iii：运输单据须显示信用证规定的装运港与卸货港 */
export const transportPorts: PresentationRule = {
  stage: "presentation",
  id: "UCP600-20A-PORTS",
  clause: "UCP600 Art.20(a)(iii)",
  title: "装运港与卸货港",
  applicable: ({ lc, presentation: p }) =>
    (!!lc.portOfLoading && !!p.transport?.portOfLoading) || (!!lc.portOfDischarge && !!p.transport?.portOfDischarge),
  evaluate({ lc, presentation: p }) {
    const out: Finding[] = [];
    const check = (lcPort: string | undefined, docPort: string | undefined, field: "44E" | "44F", docField: "portOfLoading" | "portOfDischarge", kind: "Loading" | "Discharge") => {
      if (!lcPort || !docPort) return;
      const evidence: Evidence[] = [
        { document: "transport", field: docField, value: docPort },
        { document: "lc", field, value: lcPort },
      ];
      if (isGenericPort(lcPort)) {
        out.push(makeFinding({ ruleId: this.id, clause: this.clause, severity: "doubt", code: "transport.portGeneric", params: { field, lcPort, docPort }, evidence }));
      } else if (!portMatches(lcPort, docPort)) {
        out.push(makeFinding({ ruleId: this.id, clause: this.clause, severity: "discrepancy", code: `transport.port${kind}Mismatch`, params: { lcPort, docPort }, evidence }));
      }
    };
    check(lc.portOfLoading, p.transport?.portOfLoading, "44E", "portOfLoading", "Loading");
    check(lc.portOfDischarge, p.transport?.portOfDischarge, "44F", "portOfDischarge", "Discharge");
    return out;
  },
};

export const documentRules: PresentationRule[] = [invoiceParties, goodsDescription, insuranceCover, transportPorts];
