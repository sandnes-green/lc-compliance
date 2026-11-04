import { DeleteOutlined, EditOutlined, FileSearchOutlined, PlusOutlined, RobotOutlined, UploadOutlined } from "@ant-design/icons";
import type { CheckItemDraft, CheckKind, CheckScope, CheckSeverity, CheckStatus, TextMatch } from "@lc/core";
import { App as AntApp, Alert, Button, Form, Input, Modal, Popconfirm, Progress, Segmented, Select, Space, Table, Tabs, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { CheckItem, ExtractCheckItemsResult, ManualRecord, OcrProgressEvent } from "../../shared/api";
import { useI18n } from "./i18n";

interface Props {
  open: boolean;
  onClose(): void;
}

type Filter = "all" | CheckStatus;

const STATUS_COLOR: Record<CheckStatus, string> = { candidate: "gold", enabled: "green", disabled: "default" };
const KIND_COLOR: Record<CheckKind, string> = { text: "blue", ai: "purple", manual: "cyan" };
const SEVERITY_COLOR: Record<CheckSeverity, string> = { discrepancy: "red", doubt: "orange", info: "blue" };
const SCOPES: CheckScope[] = ["invoice", "transport", "insurance", "lc"];
const KINDS: CheckKind[] = ["text", "ai", "manual"];

interface EditorValues {
  title: string;
  requirement: string;
  kind: CheckKind;
  scope: CheckScope;
  severity: CheckSeverity;
  mode: TextMatch["mode"];
  phrases: string[];
}

const toValues = (d?: CheckItem): EditorValues => ({
  title: d?.title ?? "",
  requirement: d?.requirement ?? "",
  kind: d?.kind ?? "text",
  scope: d?.scope ?? "transport",
  severity: d?.severity ?? "doubt",
  mode: d?.textMatch?.mode ?? "all",
  phrases: d?.textMatch?.phrases ?? [],
});

const toDraft = (v: EditorValues): CheckItemDraft => ({
  title: v.title,
  requirement: v.requirement,
  kind: v.kind,
  scope: v.scope,
  severity: v.severity,
  ...(v.kind === "text" ? { textMatch: { mode: v.mode, phrases: v.phrases } } : {}),
});

export default function KnowledgeModal({ open, onClose }: Props) {
  const { t, errorText } = useI18n();
  const { message } = AntApp.useApp();
  const [manuals, setManuals] = useState<ManualRecord[]>([]);
  const [items, setItems] = useState<CheckItem[]>([]);
  const [tab, setTab] = useState("manuals");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrProgressEvent | null>(null);
  const [viewing, setViewing] = useState<{ name: string; text: string } | null>(null);
  const [editor, setEditor] = useState<{ id?: string; item?: CheckItem } | null>(null);

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([window.lc.listManuals(), window.lc.listCheckItems()]);
    if (m.ok) setManuals(m.data);
    if (i.ok) setItems(i.data);
  }, []);

  useEffect(() => {
    if (open) {
      setSelected([]);
      void load();
    }
  }, [open, load]);

  // 上传扫描件手册时的识别进度
  useEffect(() => window.lc.onOcrProgress(setProgress), []);

  const upload = async () => {
    setBusy("upload");
    setProgress(null);
    try {
      const r = await window.lc.importManual();
      if (!r.ok) return void (r.code === "ocr.cancelled" ? message.info(t("ocr.cancelled")) : message.error(errorText(r)));
      if (r.data) await load();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const summarize = (r: ExtractCheckItemsResult) => {
    if (r.created.length === 0 && r.dropped.length === 0) return t("kb.extractedNone");
    const counts = new Map<string, number>();
    for (const d of r.dropped) counts.set(d.reason, (counts.get(d.reason) ?? 0) + 1);
    const reasons = [...counts].map(([reason, n]) => t(`kb.drop.${reason}`, { n })).join("、");
    return t("kb.extracted", { n: r.created.length }) + (r.dropped.length ? t("kb.extractedDropped", { m: r.dropped.length, reasons }) : "");
  };

  const extract = async (m: ManualRecord) => {
    setBusy(`extract:${m.id}`);
    try {
      const r = await window.lc.extractCheckItems(m.id);
      if (!r.ok) return void message.error(errorText(r));
      void message.success({ content: summarize(r.data), duration: 6 });
      await load();
      if (r.data.created.length > 0) {
        setFilter("candidate");
        setTab("items");
      }
    } finally {
      setBusy(null);
    }
  };

  const viewText = async (m: ManualRecord) => {
    const r = await window.lc.getManualText(m.id);
    if (r.ok) setViewing(r.data);
    else void message.error(errorText(r));
  };

  const removeManual = async (id: string) => {
    const r = await window.lc.deleteManual(id);
    if (!r.ok) void message.error(errorText(r));
    await load();
  };

  const setStatus = async (ids: string[], status: CheckStatus) => {
    if (ids.length === 0) return;
    const r = await window.lc.setCheckItemsStatus(ids, status);
    if (!r.ok) return void message.error(errorText(r));
    setSelected([]);
    void message.success(t("kb.statusChanged", { n: ids.length }));
    await load();
  };

  const removeItem = async (id: string) => {
    const r = await window.lc.deleteCheckItem(id);
    if (!r.ok) void message.error(errorText(r));
    setSelected((s) => s.filter((x) => x !== id));
    await load();
  };

  const visible = items.filter((i) => filter === "all" || i.status === filter);
  const counts = { all: items.length, candidate: 0, enabled: 0, disabled: 0 };
  for (const i of items) counts[i.status]++;

  return (
    <Modal title={t("kb.title")} open={open} onCancel={onClose} footer={null} width={1040} destroyOnClose>
      <Alert type="info" showIcon message={t("kb.intro")} style={{ marginBottom: 12 }} />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "manuals",
            label: `${t("kb.tabManuals")} (${manuals.length})`,
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space wrap>
                  <Button type="primary" icon={<UploadOutlined />} loading={busy === "upload"} disabled={busy !== null} onClick={upload}>
                    {t("kb.upload")}
                  </Button>
                  <Typography.Text type="secondary">{t("kb.sendNotice")}</Typography.Text>
                </Space>
                {busy === "upload" && progress && (
                  <Alert type="info" showIcon message={t("ocr.running", { file: progress.fileName, page: progress.page, pages: progress.pages })} description={<Progress percent={progress.percent} size="small" />} action={<Button size="small" onClick={() => void window.lc.cancelOcr()}>{t("ocr.cancel")}</Button>} />
                )}
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={manuals}
                  pagination={{ pageSize: 6, hideOnSinglePage: true }}
                  locale={{ emptyText: t("kb.manualsEmpty") }}
                  columns={[
                    {
                      title: t("kb.col.name"),
                      render: (_: unknown, m: ManualRecord) => (
                        <div>
                          <Typography.Text strong>{m.name}</Typography.Text>
                          <div><Typography.Text type="secondary">{m.fileName}</Typography.Text></div>
                        </div>
                      ),
                    },
                    {
                      title: t("kb.col.size"),
                      width: 150,
                      render: (_: unknown, m: ManualRecord) => (
                        <Space direction="vertical" size={0}>
                          <span>{t("kb.size", { n: m.chars })}</span>
                          {m.ocrConfidence !== null && <Tag color={m.ocrConfidence >= 90 ? "green" : "orange"}>{t("ocr.tag", { confidence: m.ocrConfidence })}</Tag>}
                        </Space>
                      ),
                    },
                    { title: t("kb.col.items"), width: 230, render: (_: unknown, m: ManualRecord) => t("kb.itemCounts", m.items) },
                    {
                      title: t("kb.col.actions"),
                      width: 330,
                      render: (_: unknown, m: ManualRecord) => (
                        <Space wrap>
                          <Popconfirm title={t("kb.extractConfirm")} onConfirm={() => extract(m)} okText="OK" cancelText={t("btn.cancel")}>
                            <Button size="small" type="primary" icon={<RobotOutlined />} loading={busy === `extract:${m.id}`} disabled={busy !== null}>
                              {t("kb.extract")}
                            </Button>
                          </Popconfirm>
                          <Button size="small" icon={<FileSearchOutlined />} onClick={() => viewText(m)}>
                            {t("kb.viewText")}
                          </Button>
                          <Popconfirm title={t("kb.deleteManual")} onConfirm={() => removeManual(m.id)} okText="OK" cancelText={t("btn.cancel")}>
                            <Button size="small" danger icon={<DeleteOutlined />}>
                              {t("kb.delete")}
                            </Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: "items",
            label: `${t("kb.tabItems")} (${items.length})`,
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                  <Segmented
                    value={filter}
                    onChange={(v) => {
                      setFilter(v as Filter);
                      setSelected([]);
                    }}
                    options={(["all", "candidate", "enabled", "disabled"] as const).map((f) => ({ value: f, label: `${t(`kb.filter.${f}`)} ${counts[f]}` }))}
                  />
                  <Space wrap>
                    <Button type="primary" disabled={selected.length === 0} onClick={() => setStatus(selected, "enabled")}>
                      {t("kb.enableSelected")}
                    </Button>
                    <Button disabled={selected.length === 0} onClick={() => setStatus(selected, "disabled")}>
                      {t("kb.disableSelected")}
                    </Button>
                    <Button icon={<PlusOutlined />} onClick={() => setEditor({})}>
                      {t("kb.newItem")}
                    </Button>
                  </Space>
                </Space>
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={visible}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  locale={{ emptyText: t("kb.itemsEmpty") }}
                  rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
                  columns={[
                    {
                      title: t("kb.col.item"),
                      render: (_: unknown, i: CheckItem) => (
                        <div>
                          <Typography.Text strong>{i.title}</Typography.Text>
                          <div><Typography.Text type="secondary">{i.requirement}</Typography.Text></div>
                          {i.textMatch && (
                            <div>
                              <Tag>{t(`kb.mode.${i.textMatch.mode}`)}</Tag>
                              {i.textMatch.phrases.map((p) => <Tag key={p} color="geekblue">{p}</Tag>)}
                            </div>
                          )}
                          <Tooltip title={i.source?.quote}>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {i.source ? t("kb.source", { name: i.source.manualName }) : t("kb.userDefined")}
                            </Typography.Text>
                          </Tooltip>
                        </div>
                      ),
                    },
                    { title: t("kb.col.kind"), width: 100, render: (_: unknown, i: CheckItem) => <Tag color={KIND_COLOR[i.kind]}>{t(`kb.kind.${i.kind}`)}</Tag> },
                    { title: t("kb.col.scope"), width: 90, render: (_: unknown, i: CheckItem) => t(`kb.scope.${i.scope}`) },
                    { title: t("kb.col.severity"), width: 90, render: (_: unknown, i: CheckItem) => <Tag color={SEVERITY_COLOR[i.severity]}>{t(`sev.${i.severity}`)}</Tag> },
                    { title: t("kb.col.status"), width: 90, render: (_: unknown, i: CheckItem) => <Tag color={STATUS_COLOR[i.status]}>{t(`kb.status.${i.status}`)}</Tag> },
                    {
                      title: t("kb.col.actions"),
                      width: 170,
                      render: (_: unknown, i: CheckItem) => (
                        <Space size={4} wrap>
                          {i.status === "enabled" ? (
                            <Button size="small" onClick={() => setStatus([i.id], "disabled")}>{t("kb.disable")}</Button>
                          ) : (
                            <Button size="small" type="primary" onClick={() => setStatus([i.id], "enabled")}>{t("kb.enable")}</Button>
                          )}
                          <Button size="small" icon={<EditOutlined />} onClick={() => setEditor({ id: i.id, item: i })} title={t("kb.edit")} />
                          <Popconfirm title={t("kb.deleteItem")} onConfirm={() => removeItem(i.id)} okText="OK" cancelText={t("btn.cancel")}>
                            <Button size="small" danger icon={<DeleteOutlined />} title={t("kb.delete")} />
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Space>
            ),
          },
        ]}
      />

      <Modal title={viewing ? `${t("kb.manualText")} — ${viewing.name}` : ""} open={!!viewing} onCancel={() => setViewing(null)} footer={null} width={760} destroyOnClose>
        <pre style={{ maxHeight: 460, overflow: "auto", whiteSpace: "pre-wrap", margin: 0 }}>{viewing?.text}</pre>
      </Modal>

      {editor && (
        <ItemEditor
          item={editor.item}
          onCancel={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            void message.success(t("kb.saved"));
            await load();
          }}
        />
      )}
    </Modal>
  );
}

function ItemEditor({ item, onCancel, onSaved }: { item?: CheckItem; onCancel(): void; onSaved(): void | Promise<void> }) {
  const { t, errorText } = useI18n();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<EditorValues>();
  const [saving, setSaving] = useState(false);
  const kind = Form.useWatch("kind", form) ?? item?.kind ?? "text";

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const draft = toDraft(values);
    const r = item ? await window.lc.updateCheckItem(item.id, draft) : await window.lc.createCheckItem(draft);
    setSaving(false);
    if (!r.ok) return void message.error(errorText(r)); // 主进程会指出具体哪一项无效
    await onSaved();
  };

  // 只有确定性的「文字」检查才能设为不符点；切换方式时同步修正严重程度
  const onValuesChange = (changed: Partial<EditorValues>) => {
    if (changed.kind && changed.kind !== "text" && form.getFieldValue("severity") === "discrepancy") form.setFieldValue("severity", "doubt");
  };
  const severities: CheckSeverity[] = kind === "text" ? ["discrepancy", "doubt", "info"] : ["doubt", "info"];

  return (
    <Modal title={t(item ? "kb.editor.edit" : "kb.editor.new")} open onCancel={onCancel} onOk={save} confirmLoading={saving} okText={t("btn.save")} cancelText={t("btn.cancel")} width={640} destroyOnClose>
      <Form form={form} layout="vertical" initialValues={toValues(item)} onValuesChange={onValuesChange}>
        <Form.Item name="title" label={t("kb.f.title")} rules={[{ required: true, message: t("kb.required") }]}>
          <Input maxLength={120} />
        </Form.Item>
        <Form.Item name="requirement" label={t("kb.f.requirement")} rules={[{ required: true, message: t("kb.required") }]}>
          <Input.TextArea rows={3} maxLength={800} showCount />
        </Form.Item>
        <Space align="start" wrap>
          <Form.Item name="kind" label={t("kb.f.kind")}>
            <Select style={{ width: 160 }} options={KINDS.map((k) => ({ value: k, label: t(`kb.kind.${k}`) }))} />
          </Form.Item>
          <Form.Item name="scope" label={t("kb.f.scope")}>
            <Select style={{ width: 160 }} options={SCOPES.map((s) => ({ value: s, label: t(`kb.scope.${s}`) }))} />
          </Form.Item>
          <Form.Item name="severity" label={t("kb.f.severity")}>
            <Select style={{ width: 160 }} options={severities.map((s) => ({ value: s, label: t(`sev.${s}`) }))} />
          </Form.Item>
        </Space>
        <Alert type="info" showIcon message={t(`kb.kindHint.${kind}`)} style={{ marginBottom: 12 }} />
        {kind === "text" && (
          <>
            <Form.Item name="mode" label={t("kb.f.mode")}>
              <Select style={{ width: 260 }} options={(["all", "any", "none"] as const).map((m) => ({ value: m, label: t(`kb.mode.${m}`) }))} />
            </Form.Item>
            <Form.Item name="phrases" label={t("kb.f.phrases")} extra={t("kb.f.phrasesHint")} rules={[{ required: true, type: "array", min: 1, message: t("kb.required") }]}>
              <Select mode="tags" tokenSeparators={[";", "；"]} open={false} maxTagCount="responsive" />
            </Form.Item>
          </>
        )}
        {item?.source && (
          <Form.Item label={t("kb.f.quote")}>
            <Typography.Text type="secondary">{item.source.manualName}：「{item.source.quote}」</Typography.Text>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
