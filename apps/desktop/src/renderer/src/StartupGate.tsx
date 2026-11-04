import { Spin } from "antd";
import { useEffect, useState } from "react";
import type { StartupState } from "../../shared/api";
import App from "./App";
import RecoveryScreen from "./RecoveryScreen";

/** 启动时先问主进程数据库是否已解锁：解锁了进入应用，否则只显示恢复界面 */
export default function StartupGate() {
  const [state, setState] = useState<StartupState | null>(null);

  useEffect(() => {
    void window.lc.getStartupState().then((r) => setState(r.ok ? r.data : { status: "ok" }));
  }, []);

  if (!state) return <Spin fullscreen />;
  return state.status === "locked" ? <RecoveryScreen reason={state.reason} /> : <App />;
}
