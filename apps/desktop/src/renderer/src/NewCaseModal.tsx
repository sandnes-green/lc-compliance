import { FolderOpenOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Modal, Space, Typography } from "antd";
import { useState } from "react";
import { useI18n } from "./i18n";

interface Props {
  open: boolean;
  onCancel(): void;
  onCreated(id: string): void | Promise<void>;
}

export default function NewCaseModal({ open, onCancel, onCreated }: Props) {
  const { t, errorText } = useI18n();
  const [form] = Form.useForm<{ name: string; lcText: string }>();
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [loadedName, setLoadedName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** 弹出系统文件选择框；读到的内容填入文本框，仍可手工修改 */
  const chooseFile = async () => {
    setError(null);
    const r = await window.lc.pickLcFile();
    if (!r.ok) return setError({ title: t("modal.readFailed"), text: errorText(r) });
    if (!r.data) return; // 用户取消
    form.setFieldValue("lcText", r.data.text);
    await form.validateFields(["lcText"]).catch(() => undefined);
    setLoadedName(r.data.name);
    // 案件名称为空时，用文件名（去扩展名）作为默认值
    if (!form.getFieldValue("name")) form.setFieldValue("name", r.data.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    const values = await form.validateFields();
    setBusy(true);
    setError(null);
    const r = await window.lc.createCase(values);
    setBusy(false);
    if (!r.ok) return setError({ title: t("modal.parseFailed"), text: errorText(r) });
    form.resetFields();
    setLoadedName(null);
    await onCreated(r.data.id);
  };

  return (
    <Modal
      title={t("modal.title")}
      open={open}
      onCancel={onCancel}
      onOk={submit}
      confirmLoading={busy}
      okText={t("btn.create")}
      cancelText={t("btn.cancel")}
      width={720}
      destroyOnClose
      afterClose={() => {
        setError(null);
        setLoadedName(null);
      }}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="name" label={t("modal.name")} rules={[{ required: true, message: t("modal.nameRequired") }]}>
          <Input placeholder={t("modal.namePlaceholder")} />
        </Form.Item>
        <Form.Item
          name="lcText"
          label={t("modal.lcText")}
          rules={[{ required: true, message: t("modal.lcTextRequired") }]}
          extra={
            <Space style={{ marginTop: 8 }}>
              <Button icon={<FolderOpenOutlined />} onClick={chooseFile}>
                {t("btn.chooseFile")}
              </Button>
              {loadedName && <Typography.Text type="success">{t("modal.fileLoaded", { name: loadedName })}</Typography.Text>}
            </Space>
          }
        >
          <Input.TextArea rows={14} style={{ fontFamily: "Consolas, monospace" }} placeholder={":20:LC2024-0001\n:32B:USD100000,00\n..."} />
        </Form.Item>
      </Form>
      {error && <Alert type="error" showIcon message={error.title} description={error.text} />}
    </Modal>
  );
}
