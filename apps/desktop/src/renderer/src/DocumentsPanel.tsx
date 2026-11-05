import { DeleteOutlined, EditOutlined, FilePdfOutlined, PictureOutlined, RobotOutlined, UploadOutlined } from "@ant-design/icons";
import { App as AntApp, Alert, Button, Card, Input, Modal, Popconfirm, Progress, Space, Tag, Typography } from "antd";
import type { FormInstance } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { DocKind, DocumentRecord, ExtractionResult, OcrProgressEvent, Result } from "../../shared/api";
import { useI18n } from "./i18n";

/** 与交单数据表单对应的字段 */
export interface DocFormValues {
  presentationDate: string;
  invoiceCurrency?: string;
  invoiceAmount?: string;
  sellerName?: string;
  buyerName?: string;
  goodsDescription?: string;
  shipmentDate?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  issuerName?: string;
  signingCapacity?: string;
  insuranceCurrency?: string;
  insuranceAmount?: string;
  insuranceDate?: string;
}

interface Props {
  caseId: string;
  form: FormInstance<DocFormValues>;
  unwrap<T>(r: Result<T>): T | null;
}

/** 抽取字段 → 表单字段 */
const FORM_FIELD: Record<DocKind, Record<string, keyof DocFormValues>> = {
  invoice: {
    currency: "invoiceCurrency",
    amount: "invoiceAmount",
    sellerName: "sellerName",
    buyerName: "buyerName",
    goodsDescription: "goodsDescription",
  },
  transport: { shipmentDate: "shipmentDate", portOfLoading: "portOfLoading", portOfDischarge: "portOfDischarge", issuerName: "issuerName", signingCapacity: "signingCapacity" },
  insurance: { currency: "insuranceCurrency", amount: "insuranceAmount", date: "insuranceDate" },
};

function applyToForm(form: FormInstance<DocFormValues>, docType: DocKind, extraction: ExtractionResult): number {
  const patch: Partial<DocFormValues> = {};
  for (const [name, field] of Object.entries(FORM_FIELD[docType])) {
    const f = extraction.fields[name];
    if (f) patch[field] = f.value as never;
  }
  form.setFieldsValue(patch);
  return Object.keys(patch).length;
}

/** OCR 置信度 → 标签颜色。低于 90 就应提醒用户对照原件核对 */
const confidenceColor = (c: number) => (c >= 90 ? "green" : c >= 75 ? "orange" : "red");

export default function DocumentsPanel({ caseId, form, unwrap }: Props) {
  const { t } = useI18n();
  const { message } = AntApp.useApp();
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<OcrProgressEvent | null>(null);
  const [editing, setEditing] = useState<{ doc: DocumentRecord; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = unwrap(await window.lc.listDocuments(caseId));
    if (r) setDocs(r);
  }, [caseId, unwrap]);

  useEffect(() => {
    void load();
  }, [load]);

  // 文字识别进度（主进程推送）
  useEffect(() => window.lc.onOcrProgress(setProgress), []);

  const importDoc = async (docType: DocKind) => {
    setImporting(true);
    setProgress(null);
    try {
      const r = await window.lc.importDocument(caseId, docType);
      if (!r.ok) {
        // 用户主动取消不算错误
        if (r.code === "ocr.cancelled") void message.info(t("ocr.cancelled"));
        else unwrap(r);
        return;
      }
      if (r.data) {
        await load(); // null 表示用户在文件选择框里取消
        const c = r.data.ocrConfidence;
        if (c !== null) void message.info(t("ocr.done", { confidence: c }));
      }
    } finally {
      setImporting(false);
      setProgress(null);
    }
  };

  const extract = async (doc: DocumentRecord) => {
    setBusyId(doc.id);
    try {
      const r = unwrap(await window.lc.extractDocument(doc.id));
      if (!r) return;
      await load();
      const n = applyToForm(form, doc.docType, r);
      void (n > 0 ? message.success(t("docfiles.applied")) : message.warning(t("docfiles.nothingToApply")));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    unwrap(await window.lc.deleteDocument(id));
    await load();
  };

  const openEditor = async (doc: DocumentRecord) => {
    const text = unwrap(await window.lc.getDocumentText(doc.id));
    if (text !== null) setEditing({ doc, text });
  };

  const saveText = async () => {
    if (!editing) return;
    setSaving(true);
    const r = unwrap(await window.lc.updateDocumentText(editing.doc.id, editing.text));
    setSaving(false);
    if (!r) return;
    setEditing(null);
    await load();
    void message.success(t("text.saved"));
  };

  return (
    <Card size="small" title={t("docfiles.title")} style={{ marginBottom: 24, maxWidth: 720 }}>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button icon={<UploadOutlined />} disabled={importing} onClick={() => importDoc("invoice")}>
          {t("btn.importInvoice")}
        </Button>
        <Button icon={<UploadOutlined />} disabled={importing} onClick={() => importDoc("transport")}>
          {t("btn.importTransport")}
        </Button>
        <Button icon={<UploadOutlined />} disabled={importing} onClick={() => importDoc("insurance")}>
          {t("btn.importInsurance")}
        </Button>
      </Space>

      {importing && progress && (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          message={t("ocr.running", { file: progress.fileName, page: progress.page, pages: progress.pages })}
          description={<Progress percent={progress.percent} size="small" />}
          action={
            <Button size="small" onClick={() => void window.lc.cancelOcr()}>
              {t("ocr.cancel")}
            </Button>
          }
        />
      )}

      {docs.length === 0 && <Typography.Paragraph type="secondary">{t("docfiles.empty")}</Typography.Paragraph>}

      {docs.map((d) => (
        <Card key={d.id} size="small" type="inner" style={{ marginBottom: 8 }}>
          <Space wrap>
            {d.sourceKind === "image" ? <PictureOutlined /> : <FilePdfOutlined />}
            <Typography.Text strong>{d.fileName}</Typography.Text>
            <Tag>{t(`docfiles.type.${d.docType}`)}</Tag>
            <Typography.Text type="secondary">{t("docfiles.chars", { n: d.chars })}</Typography.Text>
            {d.ocrConfidence !== null && <Tag color={confidenceColor(d.ocrConfidence)}>{t("ocr.tag", { confidence: d.ocrConfidence })}</Tag>}
            {d.needsOcr ? <Tag color="orange">{t("docfiles.scanned")}</Tag> : d.extraction ? <Tag color="green">{t("docfiles.extracted")}</Tag> : <Tag>{t("docfiles.notExtracted")}</Tag>}
          </Space>
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              {!d.needsOcr && (
                <Button size="small" type="primary" icon={<RobotOutlined />} loading={busyId === d.id} onClick={() => extract(d)}>
                  {t("btn.extract")}
                </Button>
              )}
              {!d.needsOcr && (
                <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(d)}>
                  {t("btn.viewText")}
                </Button>
              )}
              {d.extraction && (
                <Button size="small" onClick={() => void message.info(applyToForm(form, d.docType, d.extraction!) > 0 ? t("docfiles.applied") : t("docfiles.nothingToApply"))}>
                  {t("btn.apply")}
                </Button>
              )}
              <Popconfirm title={t("docfiles.deleteConfirm")} onConfirm={() => remove(d.id)} okText="OK" cancelText={t("btn.cancel")}>
                <Button size="small" danger icon={<DeleteOutlined />}>
                  {t("btn.delete")}
                </Button>
              </Popconfirm>
            </Space>
          </div>
          {d.needsOcr && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={t("docfiles.scannedHint")} />}
          {d.ocrConfidence !== null && <Alert style={{ marginTop: 8 }} type={d.ocrConfidence >= 90 ? "info" : "warning"} showIcon message={t(d.ocrConfidence >= 90 ? "ocr.checkHint" : "ocr.lowQuality", { confidence: d.ocrConfidence })} />}
          {d.extraction && <Evidence doc={d} extraction={d.extraction} />}
        </Card>
      ))}

      <Modal
        title={editing ? `${t("text.title")} — ${editing.doc.fileName}` : ""}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={saveText}
        okText={t("btn.save")}
        cancelText={t("btn.cancel")}
        confirmLoading={saving}
        width={760}
        destroyOnClose
      >
        <Alert style={{ marginBottom: 12 }} type="info" showIcon message={t("text.hint")} />
        <Input.TextArea
          value={editing?.text ?? ""}
          onChange={(e) => editing && setEditing({ ...editing, text: e.target.value })}
          rows={18}
          style={{ fontFamily: "Consolas, monospace" }}
        />
      </Modal>
    </Card>
  );
}

function Evidence({ doc, extraction }: { doc: DocumentRecord; extraction: ExtractionResult }) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 8 }}>
      <Alert type="info" showIcon message={t("docfiles.reviewNotice")} style={{ marginBottom: 8 }} />
      {Object.entries(extraction.fields).map(([name, f]) => (
        <div key={`${doc.id}-${name}`}>
          <Typography.Text>{t("docfiles.evidence", { field: t(`field.${name}`), value: f.value, quote: f.quote })}</Typography.Text>
        </div>
      ))}
      {extraction.rejected.map((r) => (
        <div key={`${doc.id}-rej-${r.name}-${r.code}`}>
          <Typography.Text type="warning">{t("docfiles.rejectedLine", { field: t(`field.${r.name}`), reason: t(`reject.${r.code}`) })}</Typography.Text>
        </div>
      ))}
    </div>
  );
}
