import { App as AntApp } from "antd";
import { createRoot } from "react-dom/client";
import StartupGate from "./StartupGate";
import { I18nProvider } from "./i18n";

createRoot(document.getElementById("root")!).render(
  <I18nProvider>
    <AntApp>
      <StartupGate />
    </AntApp>
  </I18nProvider>,
);
