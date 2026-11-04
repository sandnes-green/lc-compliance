import type { UpdaterDriver } from "@lc/services";

/**
 * electron-updater 适配。只在打包后的应用里使用（开发版 UpdateService 处于 disabled，不会调用到这里）。
 * - 更新源由 UpdateService 从管理员策略传入，这里不接受其他来源
 * - 不自动下载、不自动安装：每一步都由用户在界面上确认
 * - 不允许降级；安装包完整性由 latest.yml 中的 sha512 校验
 */
export function createElectronUpdaterDriver(): UpdaterDriver {
  let updater: typeof import("electron-updater").autoUpdater | null = null;
  const get = async () => {
    if (updater) return updater;
    // electron-updater 是 CommonJS，autoUpdater 是惰性 getter：经动态 import 取具名导出会得到 undefined，
    // 需要从 default 上取（只在打包后的应用里才会触发，开发环境不检查更新所以测不出来）
    const mod = (await import("electron-updater")) as typeof import("electron-updater") & { default?: typeof import("electron-updater") };
    const autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (!autoUpdater) throw new Error("无法加载更新组件");
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null; // 不把更新过程写到未知位置
    updater = autoUpdater;
    return updater;
  };

  let feedUrl = "";
  return {
    configure(url) {
      feedUrl = url;
    },
    async check() {
      const u = await get();
      u.setFeedURL({ provider: "generic", url: feedUrl });
      const r = await u.checkForUpdates();
      return r?.isUpdateAvailable ? { version: r.updateInfo.version } : null;
    },
    async download(onProgress) {
      const u = await get();
      const listener = (p: { percent: number }) => onProgress(p.percent);
      u.on("download-progress", listener);
      try {
        await u.downloadUpdate();
      } finally {
        u.removeListener("download-progress", listener);
      }
    },
    quitAndInstall() {
      void get().then((u) => u.quitAndInstall(false, true));
    },
  };
}
