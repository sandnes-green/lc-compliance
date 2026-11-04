import { formatLocalTime } from "@lc/core";
import { App as AntApp, Alert, AutoComplete, Button, Form, Input, Modal, Select, Space, Switch, Table, Tabs, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { AiSettings, AiSettingsInput, LlmLogEntry, OcrSettingsInfo } from "../../shared/api";
import { useI18n } from "./i18n";
import SecurityTab from "./SecurityTab";
import UpdateTab from "./UpdateTab";

interface Props {
  open: boolean;
  onClose(): void;
}

export default function SettingsModal({ open, onClose }: Props) {
  const { t, errorText } = useI18n();
  const { message, modal } = AntApp.useApp();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [log, setLog] = useState<LlmLogEntry[]>([]);
  const [keyInput, setKeyInput] = useState("");
  const [model, setModel] = useState("");
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [ocr, setOcr] = useState<OcrSettingsInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = await window.lc.getAiSettings();
    if (s.ok) {
      setSettings(s.data);
      setModel(s.data.model);
    }
    const l = await window.lc.listLlmLog();
    if (l.ok) setLog(l.data);
    const o = await window.lc.getOcrSettings();
    if (o.ok) setOcr(o.data);
  }, []);

  useEffect(() => {
    if (open) {
      setKeyInput("");
      setRemoteModels([]);
      void load();
    }
  }, [open, load]);

  /** 保存设置；失败时提示并保持原状。成功返回 true */
  const save = async (input: AiSettingsInput, okText?: string): Promise<boolean> => {
    setBusy(true);
    const r = await window.lc.saveAiSettings(input);
    setBusy(false);
    if (!r.ok) {
      void message.error(errorText(r));
      await load();
      return false;
    }
    setSettings(r.data);
    setModel(r.data.model);
    if (okText) void message.success(okText);
    return true;
  };

  const toggleEnabled = (checked: boolean) => {
    // 首次启用必须先获得用户明确同意
    if (checked && !settings?.consentAt) {
      modal.confirm({
        title: t("settings.consentTitle"),
        content: t("settings.consentBody"),
        okText: t("settings.consentOk"),
        cancelText: t("btn.cancel"),
        onOk: () => save({ enabled: true, consent: true }),
      });
      return;
    }
    void save({ enabled: checked });
  };

  const saveKeyAndModel = async () => {
    const input: AiSettingsInput = {};
    if (keyInput.trim()) input.apiKey = keyInput.trim();
    if (settings && model.trim() !== settings.model) input.model = model.trim();
    if (Object.keys(input).length === 0) return;
    if (await save(input, t("settings.saved"))) setKeyInput("");
  };

  /** 用已保存的 Key 向服务端查询可用模型（不含任何单据内容） */
  const refreshModels = async () => {
    setBusy(true);
    const r = await window.lc.listAiModels();
    setBusy(false);
    if (!r.ok) return void message.error(errorText(r));
    setRemoteModels(r.data);
    void message.success(t("settings.modelsLoaded", { n: r.data.length }));
  };

  const changeOcrLangs = async (langs: string) => {
    const r = await window.lc.saveOcrSettings(langs);
    if (!r.ok) return void message.error(errorText(r));
    setOcr(r.data);
    void message.success(t("settings.saved"));
  };

  const test = async () => {
    setBusy(true);
    const r = await window.lc.testAi();
    setBusy(false);
    if (r.ok) void message.success(t("settings.testOk"));
    else void message.error(errorText(r));
    await load(); // 测试请求也会进入外发日志
  };

  return (
    <Modal title={t("settings.title")} open={open} onCancel={onClose} footer={null} width={760} destroyOnClose>
      <Tabs
        // 切到 AI / 日志页时重新读取：策略可能在弹窗打开期间被管理员改动，日志也会增加
        onChange={(k) => (k === "log" || k === "ai") && void load()}
        items={[
          {
            key: "ai",
            label: t("settings.tabAi"),
            children: settings && (
              <Form layout="vertical">
                {settings.blockedByPolicy && <Alert type="warning" showIcon message={t("settings.aiBlocked")} style={{ marginBottom: 12 }} />}
                <Form.Item extra={t("settings.provider")}>
                  <Switch checked={settings.enabled} onChange={toggleEnabled} loading={busy} disabled={settings.blockedByPolicy} /> <span style={{ marginLeft: 8 }}>{t("settings.enable")}</span>
                </Form.Item>
                <Form.Item label={t("settings.apiKey")} extra={t("settings.keyStorage")}>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input.Password
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      placeholder={settings.hasKey ? t("settings.apiKeySaved") : "sk-…"}
                      autoComplete="off"
                    />
                    {settings.hasKey && (
                      <Button danger onClick={() => void save({ apiKey: null }, t("settings.keyCleared"))}>
                        {t("btn.clearKey")}
                      </Button>
                    )}
                  </Space.Compact>
                </Form.Item>
                <Form.Item label={t("settings.model")} extra={t("settings.modelHint")}>
                  <Space.Compact style={{ width: "100%" }}>
                    <AutoComplete
                      style={{ width: "100%" }}
                      value={model}
                      onChange={setModel}
                      // 从列表选中即保存；手工输入需点「保存」
                      onSelect={(v: string) => void save({ model: v }, t("settings.saved"))}
                      options={[...new Set([...settings.presetModels, ...remoteModels, settings.model])].map((m) => ({ value: m }))}
                      maxLength={64}
                    />
                    <Button
                      loading={busy}
                      title={settings.hasKey ? undefined : t("settings.modelNeedKey")}
                      disabled={!settings.hasKey || settings.blockedByPolicy}
                      onClick={refreshModels}
                    >
                      {t("settings.refreshModels")}
                    </Button>
                  </Space.Compact>
                  {/reason/i.test(model) && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={t("settings.reasonerHint")} />}
                </Form.Item>
                <Form.Item>
                  <Switch checked={settings.redact} onChange={(v) => void save({ redact: v })} /> <span style={{ marginLeft: 8 }}>{t("settings.redact")}</span>
                </Form.Item>
                <Space>
                  <Button type="primary" loading={busy} onClick={saveKeyAndModel}>
                    {t("btn.save")}
                  </Button>
                  <Button loading={busy} disabled={!settings.enabled || !settings.hasKey} onClick={test}>
                    {t("btn.testConn")}
                  </Button>
                </Space>
              </Form>
            ),
          },
          {
            key: "ocr",
            label: t("settings.tabOcr"),
            children: ocr && (
              <Form layout="vertical">
                <Form.Item label={t("settings.ocrLangs")} extra={t("settings.ocrHint")}>
                  <Select
                    style={{ width: 280 }}
                    value={ocr.langs}
                    onChange={changeOcrLangs}
                    options={ocr.choices.map((c) => ({ value: c, label: t(`settings.ocrLang.${c}`) }))}
                  />
                </Form.Item>
              </Form>
            ),
          },
          { key: "data", label: t("settings.tabData"), children: <SecurityTab /> },
          { key: "update", label: t("settings.tabUpdate"), children: <UpdateTab /> },
          {
            key: "log",
            label: `${t("settings.tabLog")} (${log.length})`,
            children: (
              <Space direction="vertical" style={{ width: "100%" }}>
                <Alert type="info" showIcon message={t("log.note")} />
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={log}
                  locale={{ emptyText: t("log.empty") }}
                  pagination={{ pageSize: 8, hideOnSinglePage: true }}
                  columns={[
                    { title: t("log.time"), dataIndex: "at", render: (v: string) => formatLocalTime(v) },
                    { title: t("log.model"), dataIndex: "model" },
                    { title: t("log.result"), dataIndex: "outcome", render: (o: string) => (o === "ok" ? t("log.ok") : t(`err.llm.${o}`)) },
                  ]}
                  expandable={{
                    expandedRowRender: (row) => (
                      <div>
                        <Typography.Text type="secondary">{t("log.content")}</Typography.Text>
                        <pre style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", margin: "4px 0 0" }}>
                          {row.messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n")}
                        </pre>
                        {row.response && (
                          <>
                            <Typography.Text type="secondary">{t("log.response")}</Typography.Text>
                            <pre style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{row.response}</pre>
                          </>
                        )}
                      </div>
                    ),
                  }}
                />
              </Space>
            ),
          },
        ]}
      />
    </Modal>
  );
}
