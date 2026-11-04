import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type LcApi, type LcInvokeApi } from "../shared/api";

const invoke = Object.fromEntries(
  CHANNELS.map((name) => [name, (...args: unknown[]) => ipcRenderer.invoke(`lc:${name}`, ...args)]),
) as unknown as LcInvokeApi;

/** 订阅主进程事件；只转发载荷，不把 IPC 事件对象暴露给页面 */
const subscribe =
  <T>(channel: string) =>
  (cb: (payload: T) => void) => {
    const listener = (_e: unknown, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => void ipcRenderer.removeListener(channel, listener);
  };

const api: LcApi = {
  ...invoke,
  onLanguageChanged: subscribe("lc:event:language"),
  onMenuAction: subscribe("lc:event:menu"),
  onOcrProgress: subscribe("lc:event:ocr"),
  onUpdateState: subscribe("lc:event:update"),
};

contextBridge.exposeInMainWorld("lc", api);
