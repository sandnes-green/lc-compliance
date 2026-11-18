import { BookOutlined, CloudDownloadOutlined, DeleteOutlined, GlobalOutlined, PlusOutlined, QuestionCircleOutlined, SettingOutlined } from "@ant-design/icons";
import { formatLocalTime } from "@lc/core";
import { App as AntApp, Badge, Button, Layout, List, Popconfirm, Segmented, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { CaseSummary, Result, UpdateState } from "../../shared/api";
import CaseView from "./CaseView";
import CountryRulesModal from "./CountryRulesModal";
import GuideDrawer, { QuickStart } from "./GuideDrawer";
import { useI18n } from "./i18n";
import KnowledgeModal from "./KnowledgeModal";
import NewCaseModal from "./NewCaseModal";
import SettingsModal from "./SettingsModal";
import UpdateModal from "./UpdateModal";

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
  const [countryOpen, setCountryOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  /** 后台定时检查的结果：有新版本时在「更新版本」按钮上显示红点 */
  const [updateStatus, setUpdateStatus] = useState<UpdateState["status"] | null>(null);
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

  useEffect(() => {
    void window.lc.getUpdateState().then((r) => r.ok && setUpdateStatus(r.data.status));
    return window.lc.onUpdateState((s) => setUpdateStatus(s.status));
  }, []);

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
          <Button icon={<GlobalOutlined />} block style={{ marginTop: 8 }} onClick={() => setCountryOpen(true)}>
            {t("btn.country")}
          </Button>
          <Button icon={<SettingOutlined />} block style={{ marginTop: 8 }} onClick={() => setSettingsOpen(true)}>
            {t("btn.settings")}
          </Button>
          {/* Badge 的 style 只作用于红点，root 默认 width: fit-content，撑满宽度要在 root 上覆盖；上边距也放在 root 上，红点才贴着按钮右上角 */}
          <Badge dot={updateStatus === "available" || updateStatus === "downloaded"} styles={{ root: { display: "block", width: "100%", marginTop: 8 } }}>
            <Button icon={<CloudDownloadOutlined />} block onClick={() => setUpdateOpen(true)}>
              {t("btn.update")}
            </Button>
          </Badge>
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
      <CountryRulesModal open={countryOpen} onClose={() => setCountryOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} />
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
