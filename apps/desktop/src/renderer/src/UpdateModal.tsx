import { Modal } from "antd";
import { useEffect } from "react";
import { useI18n } from "./i18n";
import UpdateTab from "./UpdateTab";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 主界面「更新版本」按钮打开的对话框：打开时自动检查一次，下载与安装仍由用户逐步确认 */
export default function UpdateModal({ open, onClose }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const r = await window.lc.getUpdateState();
      // 已发现、下载中、已下载、正在检查或被禁用时不重复检查
      if (r.ok && (r.data.status === "idle" || r.data.status === "none" || r.data.status === "error")) {
        await window.lc.checkForUpdates();
      }
    })();
  }, [open]);

  return (
    <Modal title={t("upd.title")} open={open} onCancel={onClose} footer={null} width={640} destroyOnClose>
      <UpdateTab />
    </Modal>
  );
}
