import { CheckCircleOutlined, FilePdfOutlined, FileWordOutlined, MinusCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { formatLocalTime, isCustomRuleId, isLcStageRule, localizeFinding, ruleTitle } from "@lc/core";
import { App as AntApp, Alert, Button, Card, Collapse, Descriptions, Divider, Form, Input, Space, Table, Tabs, Tag, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { CaseRecord, Presentation, ReportFormat, Result, RunRecord } from "../../shared/api";
import DocumentsPanel, { type DocFormValues } from "./DocumentsPanel";
import { useI18n } from "./i18n";

interface Props {
  caseId: string;
  initialTab?: "lc" | "docs" | "result";
  unwrap<T>(r: Result<T>): T | null;
  onChanged(): void | Promise<void>;
}

type FormValues = DocFormValues;

const SEVERITY_COLOR = { discrepancy: "red", risk: "volcano", doubt: "orange", info: "blue" } as const;

const blank = (s?: string) => (s && s.trim() !== "" ? s.trim() : undefined);
const num = (s?: string) => (blank(s) === undefined ? undefined : Number(s));
const currency = (s?: string) => blank(s)?.toUpperCase();
/** 去掉全为 undefined 的分组，避免「空的发票/运输单据」让规则误以为有数据 */
const group = <T extends object>(o: T): T | undefined => (Object.values(o).some((v) => v !== undefined) ? o : undefined);

function toPresentation(v: FormValues): Presentation {
  return {
    presentationDate: v.presentationDate,
    invoice: group({
      currency: currency(v.invoiceCurrency),
      amount: num(v.invoiceAmount),
      sellerName: blank(v.sellerName),
      buyerName: blank(v.buyerName),
      goodsDescription: blank(v.goodsDescription),
    }),
    transport: group({ shipmentDate: blank(v.shipmentDate), portOfLoading: blank(v.portOfLoading), portOfDischarge: blank(v.portOfDischarge) }),
    insurance: group({ currency: currency(v.insuranceCurrency), amount: num(v.insuranceAmount), date: blank(v.insuranceDate) }),
  };
}

function toFormValues(p: Presentation | null): FormValues {
  return {
    presentationDate: p?.presentationDate ?? "",
    invoiceCurrency: p?.invoice?.currency,
    invoiceAmount: p?.invoice?.amount?.toString(),
    sellerName: p?.invoice?.sellerName,
    buyerName: p?.invoice?.buyerName,
    goodsDescription: p?.invoice?.goodsDescription,
    shipmentDate: p?.transport?.shipmentDate,
    portOfLoading: p?.transport?.portOfLoading,
    portOfDischarge: p?.transport?.portOfDischarge,
    insuranceCurrency: p?.insurance?.currency,
    insuranceAmount: p?.insurance?.amount?.toString(),
    insuranceDate: p?.insurance?.date,
  };
}

export default function CaseView({ caseId, initialTab = "lc", unwrap, onChanged }: Props) {
  const { t, lang } = useI18n();
  const [c, setC] = useState<CaseRecord | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<string>(initialTab);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    const rec = unwrap(await window.lc.getCase(caseId));
    const rs = unwrap(await window.lc.listRuns(caseId));
    if (rec) {
      setC(rec);
      form.setFieldsValue(toFormValues(rec.presentation));
    }
    if (rs) setRuns(rs);
  }, [caseId, form, unwrap]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveAndRun = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      if (unwrap(await window.lc.savePresentation(caseId, toPresentation(v))) === null) return;
      if (unwrap(await window.lc.runCase(caseId)) === null) return;
      await load();
      await onChanged();
      setTab("result");
    } finally {
      setBusy(false);
    }
  };

  if (!c) return null;
  const { lc } = c;
  const latest = runs[0];
  const dash = "—";
  const placeholderCurrency = t("docs.currencyPlaceholder", { c: lc.currency });
  const amountRule = [{ pattern: /^\d+(\.\d{1,2})?$/, message: t("docs.amountRule") }];
  const currencyRule = [{ pattern: /^[A-Za-z]{3}$/, message: t("docs.currencyRule") }];

  return (
    <>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {c.name} <Typography.Text type="secondary">· {lc.reference}</Typography.Text>
      </Typography.Title>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "lc",
            label: t("tab.lc"),
            children: (
              <Descriptions bordered size="small" column={2}>
                <Descriptions.Item label={t("lc.reference")}>{lc.reference}</Descriptions.Item>
                <Descriptions.Item label={t("lc.issueDate")}>{lc.issueDate ?? dash}</Descriptions.Item>
                <Descriptions.Item label={t("lc.amount")}>
                  {lc.currency} {lc.amount.toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}
                </Descriptions.Item>
                <Descriptions.Item label={t("lc.tolerance")}>{lc.tolerance ? `+${lc.tolerance.plus}% / -${lc.tolerance.minus}%` : t("lc.none")}</Descriptions.Item>
                <Descriptions.Item label={t("lc.expiry")}>
                  {lc.expiryDate ?? dash} {lc.expiryPlace ?? ""}
                </Descriptions.Item>
                <Descriptions.Item label={t("lc.latestShipment")}>{lc.latestShipmentDate ?? dash}</Descriptions.Item>
                <Descriptions.Item label={t("lc.presentationPeriod")}>
                  {lc.presentationDays ? t("lc.days", { n: lc.presentationDays }) : t("lc.defaultDays")}
                </Descriptions.Item>
                <Descriptions.Item label={t("lc.beneficiary")}>{lc.beneficiaryName ?? dash}</Descriptions.Item>
                <Descriptions.Item label={t("docs.portOfLoading")}>{lc.portOfLoading ?? dash}</Descriptions.Item>
                <Descriptions.Item label={t("docs.portOfDischarge")}>{lc.portOfDischarge ?? dash}</Descriptions.Item>
                <Descriptions.Item label={t("lc.goods")} span={2}><pre style={{ margin: 0 }}>{lc.goodsDescription ?? dash}</pre></Descriptions.Item>
                <Descriptions.Item label={t("lc.documents")} span={2}><pre style={{ margin: 0 }}>{lc.documentsRequired ?? dash}</pre></Descriptions.Item>
                <Descriptions.Item label={t("lc.conditions")} span={2}><pre style={{ margin: 0 }}>{lc.additionalConditions ?? dash}</pre></Descriptions.Item>
              </Descriptions>
            ),
          },
          {
            key: "docs",
            label: t("tab.docs"),
            forceRender: true, // 保证表单在切换前就已挂载，抽取结果与已保存数据都能写入
            children: (
              <>
                <DocumentsPanel caseId={caseId} form={form} unwrap={unwrap} />
                <Form form={form} layout="vertical" style={{ maxWidth: 640 }}>
                  <Divider titlePlacement="start" plain>{t("docs.sectionGeneral")}</Divider>
                  <Form.Item name="presentationDate" label={t("docs.presentationDate")} rules={[{ required: true, message: t("docs.presentationDateRequired") }]}>
                    <Input type="date" style={{ width: 200 }} />
                  </Form.Item>

                  <Divider titlePlacement="start" plain>{t("docs.sectionInvoice")}</Divider>
                  <Form.Item name="sellerName" label={t("docs.sellerName")} extra={lc.beneficiaryName && `${t("lc.beneficiary")}: ${lc.beneficiaryName}`}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="buyerName" label={t("docs.buyerName")} extra={lc.applicantName && `${t("lc.applicant")}: ${lc.applicantName}`}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="goodsDescription" label={t("docs.goodsDescription")}>
                    <Input.TextArea rows={3} />
                  </Form.Item>
                  <Space align="start">
                    <Form.Item name="invoiceCurrency" label={t("docs.invoiceCurrency")} rules={currencyRule}>
                      <Input style={{ width: 160 }} maxLength={3} placeholder={placeholderCurrency} />
                    </Form.Item>
                    <Form.Item name="invoiceAmount" label={t("docs.invoiceAmount")} rules={amountRule}>
                      <Input style={{ width: 240 }} inputMode="decimal" />
                    </Form.Item>
                  </Space>

                  <Divider titlePlacement="start" plain>{t("docs.sectionTransport")}</Divider>
                  <Form.Item name="shipmentDate" label={t("docs.shipmentDate")}>
                    <Input type="date" style={{ width: 200 }} />
                  </Form.Item>
                  <Space align="start">
                    <Form.Item name="portOfLoading" label={t("docs.portOfLoading")} extra={lc.portOfLoading && `L/C: ${lc.portOfLoading}`}>
                      <Input style={{ width: 280 }} />
                    </Form.Item>
                    <Form.Item name="portOfDischarge" label={t("docs.portOfDischarge")} extra={lc.portOfDischarge && `L/C: ${lc.portOfDischarge}`}>
                      <Input style={{ width: 280 }} />
                    </Form.Item>
                  </Space>

                  <Divider titlePlacement="start" plain>{t("docs.sectionInsurance")}</Divider>
                  <Space align="start">
                    <Form.Item name="insuranceCurrency" label={t("docs.insuranceCurrency")} rules={currencyRule}>
                      <Input style={{ width: 160 }} maxLength={3} placeholder={placeholderCurrency} />
                    </Form.Item>
                    <Form.Item name="insuranceAmount" label={t("docs.insuranceAmount")} rules={amountRule}>
                      <Input style={{ width: 200 }} inputMode="decimal" />
                    </Form.Item>
                    <Form.Item name="insuranceDate" label={t("docs.insuranceDate")}>
                      <Input type="date" style={{ width: 180 }} />
                    </Form.Item>
                  </Space>

                  <Form.Item>
                    <Button type="primary" loading={busy} onClick={saveAndRun}>{t("btn.saveRun")}</Button>
                  </Form.Item>
                  <Typography.Paragraph type="secondary">{t("docs.optionalHint")}</Typography.Paragraph>
                  <Typography.Paragraph type="secondary">{t("docs.note")}</Typography.Paragraph>
                </Form>
              </>
            ),
          },
          {
            key: "result",
            label: `${t("tab.result")}${latest ? ` (${latest.findings.length})` : ""}`,
            children: latest ? <RunView run={latest} caseId={caseId} /> : <Alert type="info" showIcon message={t("result.notRun")} />,
          },
        ]}
      />
    </>
  );
}


function RunView({ run, caseId }: { run: RunRecord; caseId: string }) {
  const { t, lang, errorText } = useI18n();
  const { message, notification } = AntApp.useApp();
  const [exporting, setExporting] = useState<ReportFormat | null>(null);

  const exportReport = async (format: ReportFormat) => {
    setExporting(format);
    try {
      const r = await window.lc.exportReport(caseId, format);
      if (!r.ok) return void message.error(errorText(r));
      if (!r.data) return; // 用户在「另存为」里取消
      notification.success({
        message: t("report.saved"),
        description: r.data.fileName,
        duration: 8,
        btn: (
          <Button size="small" onClick={() => void window.lc.revealLastExport()}>
            {t("report.open")}
          </Button>
        ),
      });
    } finally {
      setExporting(null);
    }
  };

  const isLcFinding = (f: RunRecord["findings"][number]) => (f.stage ? f.stage === "lc" : isLcStageRule(run.coverage, f.ruleId));
  const lcFindings = run.findings.filter(isLcFinding);
  const docFindings = run.findings.filter((f) => !isLcFinding(f));
  const hasCoverage = run.coverage.checked.length + run.coverage.skipped.length > 0;
  const docsChecked = run.coverage.checked.some((id) => !isLcStageRule(run.coverage, id));
  const counts = (["discrepancy", "risk", "doubt", "info"] as const).map((s) => [s, run.findings.filter((f) => f.severity === s).length] as const);

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Typography.Text type="secondary">{t("result.meta", { at: formatLocalTime(run.at), version: run.rulesetVersion })}</Typography.Text>
      <Space wrap>
        <Button icon={<FilePdfOutlined />} loading={exporting === "pdf"} disabled={exporting !== null} onClick={() => exportReport("pdf")}>
          {t("report.exportPdf")}
        </Button>
        <Button icon={<FileWordOutlined />} loading={exporting === "docx"} disabled={exporting !== null} onClick={() => exportReport("docx")}>
          {t("report.exportWord")}
        </Button>
        <Typography.Text type="secondary">{t("report.hint")}</Typography.Text>
      </Space>
      <Space>
        {counts.filter(([, n]) => n > 0).map(([s, n]) => <Tag key={s} color={SEVERITY_COLOR[s]}>{t(`sev.${s}`)} {n}</Tag>)}
      </Space>
      {run.errors.map((e) => (
        <Alert key={e.ruleId} type="error" showIcon message={t("result.ruleError", { ruleId: e.ruleId })} description={e.message} />
      ))}

      <Section title={t("result.section.lc")} findings={lcFindings} empty={<Alert type="success" showIcon message={t("result.sectionClean")} />} />

      <Section
        title={t("result.section.docs")}
        findings={docFindings}
        empty={
          docsChecked ? (
            <Alert type="warning" showIcon message={t("result.noneTitle")} description={t("result.noneDesc")} />
          ) : (
            <Alert type="info" showIcon message={t("result.noPresentation")} />
          )
        }
      />

      <Collapse
        items={[
          {
            key: "coverage",
            label: hasCoverage ? t("result.coverage.title", { checked: run.coverage.checked.length, skipped: run.coverage.skipped.length }) : t("result.coverage.unknown"),
            children: (
              <Space direction="vertical" size={4}>
                {[...run.coverage.checked, ...run.coverage.skipped].map((id) => {
                  const skipped = run.coverage.skipped.includes(id);
                  const n = run.findings.filter((f) => f.ruleId === id).length;
                  const icon = skipped ? <MinusCircleOutlined style={{ color: "#999" }} /> : n > 0 ? <WarningOutlined style={{ color: "#fa8c16" }} /> : <CheckCircleOutlined style={{ color: "#52c41a" }} />;
                  return (
                    <div key={id}>
                      {icon} <Typography.Text strong>{ruleTitle(id, lang, run.customTitles)}</Typography.Text>{" "}
                      <Typography.Text type="secondary">
                        {skipped ? t("result.coverage.skipped") : n > 0 ? t("result.coverage.issues", { n }) : t("result.coverage.passed")}
                      </Typography.Text>
                    </div>
                  );
                })}
              </Space>
            ),
          },
        ]}
      />
    </Space>
  );
}

function Section({ title, findings, empty }: { title: string; findings: RunRecord["findings"]; empty: React.ReactNode }) {
  return (
    <div>
      <Typography.Title level={5}>{title}</Typography.Title>
      <Space direction="vertical" style={{ width: "100%" }}>
        {findings.length === 0 ? empty : findings.map((f, i) => <FindingCard key={`${f.ruleId}-${f.code}-${i}`} f={f} />)}
      </Space>
    </div>
  );
}

function FindingCard({ f }: { f: RunRecord["findings"][number] }) {
  const { t, lang } = useI18n();
  const text = localizeFinding(f, lang);
  return (
    <Card
      size="small"
      title={
        <Space align="start">
          <Tag color={SEVERITY_COLOR[f.severity]}>{t(`sev.${f.severity}`)}</Tag>
          <span style={{ whiteSpace: "normal" }}>{text.message}</span>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {isCustomRuleId(f.ruleId)
          ? t("result.basisCustom", { source: f.clause.replace(/^Custom: /, "") === "user-defined" ? t("kb.userDefined") : f.clause.replace(/^Custom: /, "") })
          : t("result.basis", { clause: f.clause, ruleId: f.ruleId })}
      </Typography.Paragraph>
      {f.evidence.length > 0 && (
        <Table
          size="small"
          pagination={false}
          rowKey={(e) => `${e.document}-${e.field}`}
          dataSource={f.evidence}
          columns={[
            { title: t("col.source"), dataIndex: "document", render: (d: string) => t(`doc.${d}`) },
            { title: t("col.field"), dataIndex: "field" },
            { title: t("col.value"), dataIndex: "value" },
          ]}
        />
      )}
      {text.suggestion && <Alert style={{ marginTop: 8 }} type="info" message={t("result.suggestion", { text: text.suggestion })} />}
    </Card>
  );
}
