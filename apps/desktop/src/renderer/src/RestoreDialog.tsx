import { App as AntApp, Alert, Button, Input, Modal, Space, Typography } from "antd";
import { useState } from "react";
import type { RestorePreview } from "../../shared/api";
import { formatLocalTime } from "@lc/core";
import { useI18n } from "./i18n";

interface Props {
  open: boolean;
  onClose(): void;
}

/**
 * 从加密备份恢复：先输口令并选文件，主进程完整校验后给出预览，用户确认才执行。
 * 校验阶段不会改动任何数据；确认后应用重启。
 */
export default function RestoreDialog({ open, onClose }: Props) {
  const { t, errorText } = useI18n();
  const { message } = AntApp.useApp();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [restarting, setRestarting] = useState(false);

  const reset = () => {
    setPassword("");
    setPreview(null);
    setBusy(false);
  };

  const choose = async () => {
    setBusy(true);
    try {
      const r = await window.lc.inspectBackup(password);
      if (!r.ok) return void message.error(errorText(r));
      if (r.data) setPreview(r.data); // null：用户在文件选择框里取消
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (preview) await window.lc.cancelRestore();
    reset();
    onClose();
  };

  const commit = async () => {
    setRestarting(true);
    const r = await window.lc.commitRestore();
    if (!r.ok) {
      setRestarting(false);
      void message.error(errorText(r));
    }
    // 成功时主进程会重启应用，这里无需处理
  };

  return (
    <Modal title={t("sec.restoreTitle")} open={open} onCancel={restarting ? undefined : cancel} footer={null} destroyOnClose maskClosable={false} closable={!restarting}>
      {restarting ? (
        <Alert type="info" showIcon message={t("sec.restoring")} />
      ) : preview ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="warning"
            showIcon
            message={t("sec.restoreConfirmTitle")}
            description={t("sec.restoreConfirmBody", { file: preview.fileName, createdAt: formatLocalTime(preview.createdAt), version: preview.appVersion, cases: preview.caseCount })}
          />
          <Space>
            <Button type="primary" danger onClick={commit}>
              {t("sec.restoreAction")}
            </Button>
            <Button onClick={cancel}>{t("btn.cancel")}</Button>
          </Space>
        </Space>
      ) : (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary">{t("sec.restoreHint")}</Typography.Paragraph>
          <Input.Password value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("sec.password")} autoComplete="off" onPressEnter={() => password && void choose()} />
          <Space>
            <Button type="primary" loading={busy} disabled={!password} onClick={choose}>
              {t("sec.restoreChoose")}
            </Button>
            <Button onClick={cancel}>{t("btn.cancel")}</Button>
          </Space>
        </Space>
      )}
    </Modal>
  );
}
