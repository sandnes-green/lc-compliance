import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { COUNTRY_REQUIREMENTS, regionName } from "@lc/core";
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

  const load = useCallback(async () => {
    const r = await window.lc.listCountryRules();
    if (r.ok) setRules(r.data);
    else void message.error(errorText(r));
  }, [message, errorText]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // 表格里的开关直接带着整条草稿保存
  const patch = async (rule: CountryRule, change: Partial<CountryRuleDraft>) => {
    const { id, ...draft } = rule;
    const r = await window.lc.saveCountryRule(id, { ...draft, ...change });
    if (!r.ok) void message.error(errorText(r));
    await load();
  };

  const remove = async (id: string) => {
    const r = await window.lc.deleteCountryRule(id);
    if (!r.ok) void message.error(errorText(r));
    await load();
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} width={960} title={t("country.title")} destroyOnClose>
      <Alert type="info" showIcon message={t("country.intro")} style={{ marginBottom: 12 }} />
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 8 }} onClick={() => setEditing({ id: null, draft: EMPTY })}>
        {t("country.add")}
      </Button>
      <Table<CountryRule>
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rules}
        columns={[
          { title: t("country.col.country"), render: (_: unknown, r: CountryRule) => `${regionName(r.countryCode, lang)}（${r.countryCode}）` },
          { title: t("country.col.level"), width: 90, render: (_: unknown, r: CountryRule) => <Tag color={r.level === "high" ? "red" : "blue"}>{t(`country.level.${r.level}`)}</Tag> },
          { title: t("country.col.requirements"), render: (_: unknown, r: CountryRule) => r.requirements.map((q) => <Tag key={q}>{t(`country.req.${q}`)}</Tag>) },
          { title: t("country.col.note"), dataIndex: "note", ellipsis: true },
          { title: t("country.col.enabled"), width: 80, render: (_: unknown, r: CountryRule) => <Switch checked={r.enabled} onChange={(v) => void patch(r, { enabled: v })} /> },
          { title: t("country.col.reviewed"), width: 90, render: (_: unknown, r: CountryRule) => <Switch checked={r.reviewed} onChange={(v) => void patch(r, { reviewed: v })} /> },
          {
            title: "",
            width: 90,
            render: (_: unknown, r: CountryRule) => (
              <Space>
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    const { id, ...draft } = r;
                    setEditing({ id, draft });
                  }}
                />
                <Popconfirm title={t("country.deleteConfirm")} onConfirm={() => remove(r.id)} okText="OK" cancelText={t("btn.cancel")}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {editing && (
        <CountryEditor
          id={editing.id}
          draft={editing.draft}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            void message.success(t("country.saved"));
            await load();
          }}
        />
      )}
    </Modal>
  );
}

function CountryEditor({ id, draft, onCancel, onSaved }: { id: string | null; draft: CountryRuleDraft; onCancel(): void; onSaved(): void | Promise<void> }) {
  const { t, errorText } = useI18n();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<CountryRuleDraft>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    // 启用 / 已审核两个开关不在表单里，沿用原值
    const r = await window.lc.saveCountryRule(id, { ...draft, ...values, countryCode: values.countryCode.trim().toUpperCase() });
    setSaving(false);
    if (!r.ok) return void message.error(errorText(r));
    await onSaved();
  };

  return (
    <Modal open onCancel={onCancel} onOk={save} confirmLoading={saving} okText={t("btn.save")} cancelText={t("btn.cancel")} title={t("country.title")} destroyOnClose>
      <Form form={form} layout="vertical" initialValues={draft}>
        <Form.Item name="countryCode" label={t("country.form.code")} rules={[{ required: true, pattern: /^[A-Za-z]{2}$/, message: t("country.form.codeInvalid") }]}>
          <Input maxLength={2} style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="level" label={t("country.form.level")}>
          <Select style={{ width: 160 }} options={(["notice", "high"] as const).map((v) => ({ value: v, label: t(`country.level.${v}`) }))} />
        </Form.Item>
        <Form.Item name="requirements" label={t("country.form.requirements")}>
          <Checkbox.Group options={COUNTRY_REQUIREMENTS.map((q) => ({ value: q, label: t(`country.req.${q}`) }))} />
        </Form.Item>
        <Form.Item name="note" label={t("country.form.note")}>
          <Input.TextArea rows={3} maxLength={2000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
