import { BulbOutlined } from "@ant-design/icons";
import { Alert, Button, Collapse, Drawer, Empty, Input, Space, Table, Tag, Typography } from "antd";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { DICTS } from "./i18n-dicts";
import { GUIDE, resolveGuideText, searchGuide, type Block } from "./guide-content";
import { useI18n } from "./i18n";

const SEV_COLOR = { discrepancy: "red", risk: "volcano", doubt: "orange", info: "blue" } as const;

/** 行内格式：**加粗**；「按钮名」与“界面文字”用蓝色强调，便于在界面上找到 */
export function Rich({ text, dict }: { text: string; dict: Record<string, string> }): ReactNode {
  const parts = resolveGuideText(text, dict).split(/(\*\*[^*]+\*\*|「[^」]+」|“[^”]+”)/);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("「") || p.startsWith("“")) return <strong key={i} style={{ color: "#1456b8" }}>{p}</strong>;
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

export function Steps({ items, dict }: { items: string[]; dict: Record<string, string> }) {
  return (
    <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 12px" }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
          <span
            style={{ flex: "0 0 26px", height: 26, borderRadius: 13, background: "#1456b8", color: "#fff", textAlign: "center", lineHeight: "26px", fontWeight: 600, fontSize: 13 }}
          >
            {i + 1}
          </span>
          <span style={{ lineHeight: "26px" }}>
            <Rich text={it} dict={dict} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function BlockView({ b, dict, labels }: { b: Block; dict: Record<string, string>; labels: { sev: (s: keyof typeof SEV_COLOR) => string; term: string; desc: string; sevLegend: string } }) {
  switch (b.type) {
    case "p":
      return <Typography.Paragraph style={{ fontSize: 15 }}><Rich text={b.text} dict={dict} /></Typography.Paragraph>;
    case "steps":
      return <Steps items={b.items} dict={dict} />;
    case "list":
      return (
        <ul style={{ fontSize: 15, paddingLeft: 22 }}>
          {b.items.map((it, i) => (
            <li key={i} style={{ marginBottom: 6 }}><Rich text={it} dict={dict} /></li>
          ))}
        </ul>
      );
    case "tip":
      return <Alert style={{ margin: "8px 0 12px" }} type="success" showIcon icon={<BulbOutlined />} message={<Rich text={b.text} dict={dict} />} />;
    case "note":
      return <Alert style={{ margin: "8px 0 12px" }} type="info" showIcon message={<Rich text={b.text} dict={dict} />} />;
    case "warn":
      return <Alert style={{ margin: "8px 0 12px" }} type="warning" showIcon message={<Rich text={b.text} dict={dict} />} />;
    case "severity":
      return (
        <div style={{ margin: "8px 0 12px" }}>
          {b.items.map((i) => (
            <div key={i.sev} style={{ display: "flex", gap: 12, marginBottom: 8, alignItems: "flex-start" }}>
              <Tag color={SEV_COLOR[i.sev]} style={{ flex: "0 0 auto", margin: 0, fontSize: 14, padding: "2px 10px" }}>{labels.sev(i.sev)}</Tag>
              <span><Rich text={i.desc} dict={dict} /></span>
            </div>
          ))}
        </div>
      );
    case "terms":
      return (
        <Table
          size="small"
          pagination={false}
          rowKey="term"
          dataSource={b.items}
          columns={[
            { title: labels.term, dataIndex: "term", width: 190, render: (t: string) => <strong>{t}</strong> },
            { title: labels.desc, dataIndex: "desc", render: (d: string) => <Rich text={d} dict={dict} /> },
          ]}
        />
      );
    case "faq":
      return (
        <Collapse
          style={{ margin: "8px 0 12px" }}
          items={b.items.map((f, i) => ({
            key: String(i),
            label: <strong><Rich text={f.q} dict={dict} /></strong>,
            children: <div style={{ fontSize: 15 }}><Rich text={f.a} dict={dict} /></div>,
          }))}
        />
      );
  }
}

interface Props {
  open: boolean;
  onClose(): void;
  /** 首次自动打开时显示欢迎语与「开始使用」按钮 */
  welcome?: boolean;
}

export default function GuideDrawer({ open, onClose, welcome }: Props) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState("");
  // 关闭时清空搜索：否则再次打开仍是上次的过滤结果，会误以为指南内容缺失（切换语言后关键词也不再适用）
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  const dict = DICTS[lang];
  const sections = useMemo(() => searchGuide(lang, dict, query), [lang, dict, query]);
  const titleOf = (s: string) => resolveGuideText(s, dict);

  const jump = (id: string) => document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const labels = { sev: (s: keyof typeof SEV_COLOR) => t(`sev.${s}`), term: t("guide.terms.term"), desc: t("guide.terms.desc"), sevLegend: t("guide.sevLegend") };

  return (
    <Drawer
      title={t("guide.title")}
      open={open}
      onClose={onClose}
      width="min(1000px, 92vw)"
      destroyOnClose
      extra={welcome && <Button type="primary" onClick={onClose}>{t("guide.start")}</Button>}
    >
      {welcome && <Alert type="info" showIcon message={<Rich text={t("guide.welcome")} dict={dict} />} style={{ marginBottom: 16 }} />}
      <Input.Search allowClear placeholder={t("guide.search")} value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: 16 }} />
      {sections.length === 0 ? (
        <Empty description={t("guide.noResult")} />
      ) : (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <nav style={{ flex: "0 0 200px", position: "sticky", top: 0 }}>
            <Space direction="vertical" size={2} style={{ width: "100%" }}>
              {sections.map((s) => (
                <Button key={s.id} type="text" block style={{ textAlign: "left", justifyContent: "flex-start", height: "auto", whiteSpace: "normal", padding: "6px 10px" }} onClick={() => jump(s.id)}>
                  {titleOf(s.title)}
                </Button>
              ))}
            </Space>
          </nav>
          <div style={{ flex: 1, minWidth: 0 }}>
            {sections.map((s) => (
              <section key={s.id} id={`guide-${s.id}`} style={{ marginBottom: 32 }}>
                <Typography.Title level={4} style={{ borderBottom: "2px solid #e6eefb", paddingBottom: 6 }}>{titleOf(s.title)}</Typography.Title>
                {s.blocks.map((b, i) => (
                  <BlockView key={i} b={b} dict={dict} labels={labels} />
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  );
}

/** 首页（没选案件时）的快速上手卡片 */
export function QuickStart({ onOpenGuide }: { onOpenGuide(): void }) {
  const { t, lang } = useI18n();
  const dict = DICTS[lang];
  const steps = GUIDE[lang].find((s) => s.id === "quickstart")?.blocks.find((b) => b.type === "steps");
  return (
    <div style={{ maxWidth: 760, margin: "40px auto 0" }}>
      <Typography.Title level={4}>{t("guide.quickTitle")}</Typography.Title>
      <Typography.Paragraph type="secondary"><Rich text={t("guide.quickHint")} dict={dict} /></Typography.Paragraph>
      {steps && steps.type === "steps" && <Steps items={steps.items} dict={dict} />}
      <Button type="primary" size="large" onClick={onOpenGuide} icon={<BulbOutlined />}>
        {t("guide.open")}
      </Button>
    </div>
  );
}
