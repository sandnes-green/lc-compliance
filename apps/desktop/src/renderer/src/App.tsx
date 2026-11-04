import { BookOutlined, DeleteOutlined, PlusOutlined, QuestionCircleOutlined, SettingOutlined } from "@ant-design/icons";
import { formatLocalTime } from "@lc/core";
import { App as AntApp, Button, Layout, List, Popconfirm, Segmented, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { CaseSummary, Result } from "../../shared/api";
import CaseView from "./CaseView";
import GuideDrawer, { QuickStart } from "./GuideDrawer";
import { useI18n } from "./i18n";
import KnowledgeModal from "./KnowledgeModal";
import NewCaseModal from "./NewCaseModal";
import SettingsModal from "./SettingsModal";

const { Sider, Content } = Layout;

export default function App() {
  const { message } = AntApp.useApp();
  const { t, lang, setLang, errorText } = useI18n();
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** 刚新建的案件：已自动审证，直接打开结果页 */
  const [freshId, setFreshId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  /** 首次启动自动打开的那一次（带欢迎语） */
  const [guideWelcome, setGuideWelcome] = useState(false);

  /** 统一处理 IPC 结果：失败时用当前语言提示并返回 null */
  const unwrap = useCallback(
    <T,>(r: Result<T>): T | null => {
      if (r.ok) return r.data;
      void message.error(errorText(r));
      return null;
    },
    [message, errorText],
  );

  const refresh = useCallback(async () => {
    const list = unwrap(await window.lc.listCases());
    if (list) setCases(list);
  }, [unwrap]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 菜单「文件 → 新建案件」
  useEffect(
    () =>
      window.lc.onMenuAction((a) => {
        if (a === "newCase") setCreating(true);
        if (a === "guide") {
          setGuideWelcome(false);
          setGuideOpen(true);
        }
      }),
    [],
  );

  // 第一次打开软件时自动显示使用指南（只一次；自检模式不弹，以免遮挡自动化检查）
  useEffect(() => {
    if (new URLSearchParams(location.search).has("smoke")) return;
    try {
      if (!localStorage.getItem("lc.guide.seen")) {
        localStorage.setItem("lc.guide.seen", "1");
        setGuideWelcome(true);
        setGuideOpen(true);
      }
    } catch {
      /* 本地存储不可用时不自动弹 */
    }
  }, []);

  const remove = async (id: string) => {
    unwrap(await window.lc.deleteCase(id));
    if (selected === id) setSelected(null);
    await refresh();
  };

  return (
    <Layout style={{ height: "100vh" }}>
      <Sider width={300} theme="light" style={{ borderRight: "1px solid #f0f0f0", overflow: "auto" }}>
        <div style={{ padding: 16 }}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t("app.title")}
          </Typography.Title>
          <Button type="primary" icon={<PlusOutlined />} block onClick={() => setCreating(true)}>
            {t("btn.newCase")}
          </Button>
          <Button icon={<QuestionCircleOutlined />} block style={{ marginTop: 8 }} onClick={() => { setGuideWelcome(false); setGuideOpen(true); }}>
            {t("btn.guide")}
          </Button>
          <Button icon={<BookOutlined />} block style={{ marginTop: 8 }} onClick={() => setKnowledgeOpen(true)}>
            {t("btn.knowledge")}
          </Button>
          <Button icon={<SettingOutlined />} block style={{ marginTop: 8 }} onClick={() => setSettingsOpen(true)}>
            {t("btn.settings")}
          </Button>
          <Segmented
            block
            style={{ marginTop: 12 }}
            value={lang}
            onChange={(v) => setLang(v as "zh" | "en")}
            options={[
              { label: "中文", value: "zh" },
              { label: "English", value: "en" },
            ]}
            aria-label={t("app.language")}
          />
        </div>
        <List
          dataSource={cases}
          locale={{ emptyText: t("cases.empty") }}
          renderItem={(c) => (
            <List.Item
              onClick={() => setSelected(c.id)}
              style={{ cursor: "pointer", padding: "10px 16px", background: c.id === selected ? "#e6f4ff" : undefined }}
              actions={[
                <Popconfirm key="d" title={t("cases.deleteConfirm")} onConfirm={() => remove(c.id)} okText="OK" cancelText={t("btn.cancel")}>
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={(e) => e.stopPropagation()} />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta title={c.name} description={`${c.lcReference} · ${formatLocalTime(c.updatedAt).slice(0, 16)}`} />
            </List.Item>
          )}
        />
      </Sider>
      <Content style={{ padding: 24, overflow: "auto" }}>
        {selected ? <CaseView key={selected} caseId={selected} initialTab={selected === freshId ? "result" : "lc"} unwrap={unwrap} onChanged={refresh} /> : <QuickStart onOpenGuide={() => { setGuideWelcome(false); setGuideOpen(true); }} />}
      </Content>
      <GuideDrawer open={guideOpen} welcome={guideWelcome} onClose={() => setGuideOpen(false)} />
      <KnowledgeModal open={knowledgeOpen} onClose={() => setKnowledgeOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <NewCaseModal
        open={creating}
        onCancel={() => setCreating(false)}
        onCreated={async (id) => {
          setCreating(false);
          // 收到信用证就先做审证（只看信用证本身，不需要单据）
          unwrap(await window.lc.runCase(id));
          await refresh();
          setFreshId(id);
          setSelected(id);
        }}
      />
    </Layout>
  );
}
