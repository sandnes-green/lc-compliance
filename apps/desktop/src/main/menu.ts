import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { Language, MenuAction } from "../shared/api";

const L = {
  zh: {
    file: "文件", newCase: "新建案件", quit: "退出",
    edit: "编辑", undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", selectAll: "全选",
    view: "视图", zoomIn: "放大", zoomOut: "缩小", zoomReset: "实际大小", fullscreen: "全屏", devtools: "开发者工具",
    language: "语言",
    help: "帮助", guide: "使用指南",
  },
  en: {
    file: "File", newCase: "New Case", quit: "Exit",
    edit: "Edit", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select All",
    view: "View", zoomIn: "Zoom In", zoomOut: "Zoom Out", zoomReset: "Actual Size", fullscreen: "Full Screen", devtools: "Developer Tools",
    language: "Language",
    help: "Help", guide: "User Guide",
  },
} as const;

export const WINDOW_TITLE: Record<Language, string> = { zh: "信用证合规自查", en: "L/C Compliance Check" };
export const DIALOG_TEXT: Record<Language, { openLc: string; swift: string; all: string; openInvoice: string; openTransport: string; openInsurance: string; openManual: string; manuals: string; docs: string }> = {
  zh: { openLc: "选择信用证报文文件", swift: "SWIFT 报文 / 文本", all: "所有文件", openInvoice: "选择商业发票文件", openTransport: "选择运输单据（提单等）文件", openInsurance: "选择保险单据文件", openManual: "选择手册文件（审单清单、客户要求等）", manuals: "手册文件（PDF / Word / 文本 / 图片）", docs: "单据文件（PDF / Word / 文本 / 图片）" },
  en: { openLc: "Select L/C message file", swift: "SWIFT message / text", all: "All files", openInvoice: "Select commercial invoice file", openTransport: "Select transport document (B/L etc.) file", openInsurance: "Select insurance document file", openManual: "Select a manual (checklist, customer requirements, etc.)", manuals: "Manual files (PDF / Word / text / image)", docs: "Document files (PDF / Word / text / image)" },
};

export function buildMenu(lang: Language, onLanguage: (l: Language) => void, onAction: (a: MenuAction) => void): Menu {
  const t = L[lang];
  const template: MenuItemConstructorOptions[] = [
    {
      label: t.file,
      submenu: [
        { label: t.newCase, accelerator: "CmdOrCtrl+N", click: () => onAction("newCase") },
        { type: "separator" },
        { label: t.quit, accelerator: "Alt+F4", click: () => app.quit() },
      ],
    },
    {
      label: t.edit,
      submenu: [
        { role: "undo", label: t.undo },
        { role: "redo", label: t.redo },
        { type: "separator" },
        { role: "cut", label: t.cut },
        { role: "copy", label: t.copy },
        { role: "paste", label: t.paste },
        { role: "selectAll", label: t.selectAll },
      ],
    },
    {
      label: t.view,
      submenu: [
        { role: "zoomIn", label: t.zoomIn },
        { role: "zoomOut", label: t.zoomOut },
        { role: "resetZoom", label: t.zoomReset },
        { type: "separator" },
        { role: "togglefullscreen", label: t.fullscreen },
        // 开发者工具仅在未打包（开发）时提供
        ...(app.isPackaged ? [] : ([{ role: "toggleDevTools", label: t.devtools }] as MenuItemConstructorOptions[])),
      ],
    },
    { label: t.help, submenu: [{ label: t.guide, accelerator: "F1", click: () => onAction("guide") }] },
    {
      label: lang === "zh" ? `${t.language} / Language` : `${t.language} / 语言`,
      submenu: [
        { label: "中文", type: "radio", checked: lang === "zh", click: () => onLanguage("zh") },
        { label: "English", type: "radio", checked: lang === "en", click: () => onLanguage("en") },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

export function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}
