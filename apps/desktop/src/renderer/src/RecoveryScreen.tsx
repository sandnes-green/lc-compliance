import { LockOutlined } from "@ant-design/icons";
import { Button, Result, Segmented, Space } from "antd";
import { useState } from "react";
import type { LockReason } from "../../shared/api";
import { useI18n } from "./i18n";
import RestoreDialog from "./RestoreDialog";

/** 数据库打不开时显示的界面：不显示任何业务功能，只提供「从备份恢复」和退出 */
export default function RecoveryScreen({ reason }: { reason: LockReason }) {
  const { t, lang, setLang } = useI18n();
  const [restoring, setRestoring] = useState(false);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <Result
        icon={<LockOutlined style={{ color: "#cf1322" }} />}
        title={t("rec.title")}
        subTitle={
          <>
            <div>{t(`rec.reason.${reason}`)}</div>
            <div style={{ marginTop: 8 }}>{t("rec.body")}</div>
          </>
        }
        extra={
          <Space direction="vertical" align="center">
            <Space>
              <Button type="primary" onClick={() => setRestoring(true)}>
                {t("sec.restore")}
              </Button>
              <Button onClick={() => void window.lc.quitApp()}>{t("rec.quit")}</Button>
            </Space>
            <Segmented
              value={lang}
              onChange={(v) => setLang(v as "zh" | "en")}
              options={[
                { label: "中文", value: "zh" },
                { label: "English", value: "en" },
              ]}
            />
          </Space>
        }
      />
      <RestoreDialog open={restoring} onClose={() => setRestoring(false)} />
    </div>
  );
}
