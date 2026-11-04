import type { Policy } from "./policy";

/** 对 electron-updater 的最小抽象，便于测试时替换 */
export interface UpdaterDriver {
  configure(feedUrl: string): void;
  /** 检查更新；没有新版本返回 null */
  check(): Promise<{ version: string } | null>;
  download(onProgress: (percent: number) => void): Promise<void>;
  quitAndInstall(): void;
}

export type UpdateStatus = "disabled" | "idle" | "checking" | "none" | "available" | "downloading" | "downloaded" | "error";
export type UpdateDisabledReason = "policy" | "noFeed" | "devBuild";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  /** 下载进度 0..100 */
  percent: number;
  error: string | null;
  lastCheckedAt: string | null;
  feedUrl: string | null;
  disabledReason: UpdateDisabledReason | null;
}

export interface UpdateDeps {
  driver: UpdaterDriver;
  policy: () => Policy;
  currentVersion: string;
  /** 开发环境（未打包）不检查更新，避免把开发版替换成安装版 */
  isPackaged: boolean;
  now?: () => Date;
}

/**
 * 更新状态机。规则：
 * - 更新源只来自管理员策略；未打包、策略禁用或没有更新源时为 disabled
 * - 检查与下载互斥；有新版本后须由用户确认才下载，下载完再由用户确认才重启安装
 * - 检查失败只进入 error 状态（附原因），下次检查可重试，不会抛出打断调用方
 */
export class UpdateService {
  private state: UpdateState;
  private readonly listeners = new Set<(s: UpdateState) => void>();

  constructor(private readonly d: UpdateDeps) {
    this.state = this.baseState();
  }

  private disabledReason(): UpdateDisabledReason | null {
    if (!this.d.isPackaged) return "devBuild";
    const p = this.d.policy().update;
    if (!p.enabled) return "policy";
    if (!p.feedUrl) return "noFeed";
    return null;
  }

  private baseState(): UpdateState {
    const reason = this.disabledReason();
    return {
      status: reason ? "disabled" : "idle",
      currentVersion: this.d.currentVersion,
      availableVersion: null,
      percent: 0,
      error: null,
      lastCheckedAt: null,
      feedUrl: this.d.policy().update.feedUrl,
      disabledReason: reason,
    };
  }

  getState(): UpdateState {
    // 策略可能在运行期间被管理员改动：被禁用时立刻反映出来
    const reason = this.disabledReason();
    if (reason && this.state.status !== "disabled") this.state = { ...this.baseState(), lastCheckedAt: this.state.lastCheckedAt };
    if (!reason && this.state.status === "disabled") this.state = { ...this.baseState(), lastCheckedAt: this.state.lastCheckedAt };
    return this.state;
  }

  subscribe(cb: (s: UpdateState) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
    return this.state;
  }

  /** 是否应在启动后自动检查 */
  get autoCheck(): boolean {
    return this.disabledReason() === null && this.d.policy().update.autoCheck;
  }

  async check(): Promise<UpdateState> {
    const s = this.getState();
    if (s.status === "disabled" || s.status === "checking" || s.status === "downloading" || s.status === "downloaded") return s;
    this.d.driver.configure(s.feedUrl!);
    this.set({ status: "checking", error: null });
    try {
      const r = await this.d.driver.check();
      const at = (this.d.now?.() ?? new Date()).toISOString();
      return r ? this.set({ status: "available", availableVersion: r.version, lastCheckedAt: at }) : this.set({ status: "none", availableVersion: null, lastCheckedAt: at });
    } catch (e) {
      return this.set({ status: "error", error: e instanceof Error ? e.message : String(e), lastCheckedAt: (this.d.now?.() ?? new Date()).toISOString() });
    }
  }

  async download(): Promise<UpdateState> {
    if (this.getState().status !== "available") return this.state;
    this.set({ status: "downloading", percent: 0, error: null });
    try {
      await this.d.driver.download((p) => this.set({ percent: Math.max(0, Math.min(100, Math.round(p))) }));
      return this.set({ status: "downloaded", percent: 100 });
    } catch (e) {
      // 下载失败回到「有新版本」，允许重试
      return this.set({ status: "available", percent: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 仅在已下载完成时才会重启安装；返回是否已触发 */
  install(): boolean {
    if (this.getState().status !== "downloaded") return false;
    this.d.driver.quitAndInstall();
    return true;
  }
}
