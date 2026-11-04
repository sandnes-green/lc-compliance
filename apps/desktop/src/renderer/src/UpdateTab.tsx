import { formatLocalTime } from "@lc/core";
import { App as AntApp, Alert, Button, Card, Progress, Space, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { AppInfo, PolicyInfo, UpdateState } from "../../shared/api";
import { useI18n } from "./i18n";

export default function UpdateTab() {
  const { t, errorText } = useI18n();
  const { message } = AntApp.useApp();
  const [state, setState] = useState<UpdateState | null>(null);
  const [policy, setPolicy] = useState<PolicyInfo | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  const load = useCallback(async () => {
    const [u, p, a] = await Promise.all([window.lc.getUpdateState(), window.lc.getPolicyInfo(), window.lc.getAppInfo()]);
    if (u.ok) setState(u.data);
    if (p.ok) setPolicy(p.data);
    if (a.ok) setInfo(a.data);
  }, []);

  useEffect(() => {
    void load();
    return window.lc.onUpdateState(setState);
  }, [load]);

  const run = async (fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string; code?: string; params?: Record<string, string | number> }>) => {
    const r = await fn();
    if (!r.ok) void message.error(errorText(r));
  };

  if (!state) return null;
  const busy = state.status === "checking" || state.status === "downloading";

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      <Card size="small" title={t("upd.title")}>
        <Space direction="vertical" style={{ width: "100%" }}>
          <Typography.Text>{t("upd.current", { v: info?.version ?? state.currentVersion })}</Typography.Text>
          {state.feedUrl && <Typography.Text type="secondary">{t("upd.feed", { url: state.feedUrl })}</Typography.Text>}

          {state.status === "disabled" && <Alert type="info" showIcon message={t(`upd.disabled.${state.disabledReason ?? "noFeed"}`)} />}
          {state.status === "none" && <Alert type="success" showIcon message={t("upd.none")} />}
          {state.status === "checking" && <Alert type="info" showIcon message={t("upd.checking")} />}
          {state.status === "available" && <Alert type="info" showIcon message={t("upd.available", { v: state.availableVersion ?? "" })} />}
          {state.status === "downloading" && <Alert type="info" showIcon message={t("upd.downloading", { p: state.percent })} description={<Progress percent={state.percent} size="small" />} />}
          {state.status === "downloaded" && <Alert type="success" showIcon message={t("upd.downloaded", { v: state.availableVersion ?? "" })} description={t("upd.installNote")} />}
          {state.error && <Alert type="error" showIcon message={t("upd.error", { error: state.error })} />}

          <Space wrap>
            <Button disabled={state.status === "disabled" || busy || state.status === "downloaded"} loading={state.status === "checking"} onClick={() => run(() => window.lc.checkForUpdates())}>
              {t("upd.check")}
            </Button>
            {state.status === "available" && (
              <Button type="primary" onClick={() => run(() => window.lc.downloadUpdate())}>
                {t("upd.download")}
              </Button>
            )}
            {state.status === "downloaded" && (
              <Button type="primary" danger onClick={() => run(() => window.lc.installUpdate())}>
                {t("upd.install")}
              </Button>
            )}
            {state.lastCheckedAt && <Typography.Text type="secondary">{t("upd.lastChecked", { time: formatLocalTime(state.lastCheckedAt) })}</Typography.Text>}
          </Space>
          <Typography.Text type="secondary">{t("upd.policyNote")}</Typography.Text>
        </Space>
      </Card>

      {policy && (
        <Card size="small" title={t("pol.title")}>
          <Space direction="vertical">
            <Typography.Text type="secondary">{t("pol.file", { file: policy.file })}</Typography.Text>
            {!policy.found && <Typography.Text>{t("pol.notFound")}</Typography.Text>}
            {policy.warnings.map((w, i) => (
              <Alert key={i} type="warning" showIcon message={t(`pol.warning.${w.code}`, { field: w.field ?? "" })} />
            ))}
          </Space>
        </Card>
      )}
    </Space>
  );
}
