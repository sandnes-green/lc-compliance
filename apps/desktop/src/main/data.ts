import {
  AppError,
} from "@lc/core";
import {
  applyRestore,
  autoBackupDue,
  createBackupFile,
  listAutoBackups,
  openEncryptedStore,
  prepareRestore,
  runAutoBackup,
  validatePassword,
  type PreparedRestore,
  type SecretBox,
} from "@lc/services";
import type { CaseStore } from "@lc/storage";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BackupResult, RestorePreview, SecurityStatus, StartupState } from "../shared/api";

export interface DataDirs {
  root: string;
  db: string;
  keystore: string;
  backups: string;
  autoBackups: string;
  tmp: string;
}

export const dataDirs = (root: string): DataDirs => ({
  root,
  db: join(root, "lc.db"),
  keystore: join(root, "keystore.json"),
  backups: join(root, "backups"),
  autoBackups: join(root, "backups", "auto"),
  tmp: join(root, "tmp"),
});

const K = { autoEnabled: "backup.autoEnabled", autoKeep: "backup.autoKeep", lastAt: "backup.lastAt" } as const;
export const DEFAULT_AUTO_KEEP = 7;
const MAX_BACKUP_FILE = 2 * 1024 * 1024 * 1024;

export interface DataDeps {
  dirs: DataDirs;
  box: SecretBox;
  appVersion: string;
  /** 弹出「另存为」/「打开」对话框；用户取消返回 null */
  pickSave(defaultName: string): Promise<string | null>;
  pickOpen(): Promise<string | null>;
}

/**
 * 管理加密数据库的生命周期：打开（含首次建库/旧库迁移）、备份、恢复、自动快照。
 * 数据库打不开时进入 locked 状态，只留恢复入口，不触碰任何数据。
 */
export class DataManager {
  store: CaseStore | null = null;
  private key: Buffer | null = null;
  state: StartupState = { status: "ok" };
  private pending: { prepared: PreparedRestore; fileName: string } | null = null;

  constructor(private readonly d: DataDeps) {}

  /** 打开数据库。致命错误（如系统加密不可用）会抛出，由调用方提示并退出 */
  open(): { migrated: boolean; firstRun: boolean } {
    mkdirSync(this.d.dirs.root, { recursive: true });
    this.cleanTmp();
    const r = openEncryptedStore({ dbPath: this.d.dirs.db, keystorePath: this.d.dirs.keystore, box: this.d.box });
    if (!r.ok) {
      this.state = { status: "locked", reason: r.reason, message: r.message };
      return { migrated: false, firstRun: false };
    }
    this.store = r.store;
    this.key = r.key;
    this.state = { status: "ok" };
    return { migrated: r.migrated, firstRun: r.firstRun };
  }

  close(): void {
    this.store?.close();
    this.store = null;
  }

  /** 临时目录里只会有校验到一半的恢复文件，启动时清掉 */
  private cleanTmp(): void {
    try {
      for (const f of readdirSync(this.d.dirs.tmp)) rmSync(join(this.d.dirs.tmp, f), { recursive: true, force: true });
    } catch {
      /* 目录不存在 */
    }
  }

  private need(): CaseStore {
    if (!this.store) throw new AppError("app.locked", "数据库未解锁", {});
    return this.store;
  }

  status(): SecurityStatus {
    const s = this.need();
    const keep = Number(s.getSetting(K.autoKeep)) || DEFAULT_AUTO_KEEP;
    return {
      encrypted: s.encrypted,
      dataDir: this.d.dirs.root,
      backupDir: this.d.dirs.backups,
      lastBackupAt: s.getSetting(K.lastAt),
      auto: {
        enabled: s.getSetting(K.autoEnabled) !== "0",
        keep,
        items: listAutoBackups(this.d.dirs.autoBackups).map((b) => ({ name: b.name, bytes: b.bytes, at: b.at })),
      },
    };
  }

  verify() {
    return this.need().verifyIntegrity();
  }

  async createBackup(password: string): Promise<BackupResult | null> {
    const s = this.need();
    validatePassword(password); // 先校验口令，免得用户选完保存位置才被告知太短
    const out = await this.d.pickSave(`lc-backup-${new Date().toISOString().slice(0, 10)}.lcbak`);
    if (!out) return null;
    const r = await createBackupFile(s, { dataKey: this.key!, password, outPath: out, appVersion: this.d.appVersion, tmpDir: this.d.dirs.tmp });
    s.setSetting(K.lastAt, new Date().toISOString());
    s.logEvent("backup.create", { bytes: r.bytes }); // 审计只记录动作，不记录路径与口令
    return { fileName: basename(out), bytes: r.bytes };
  }

  /** 选择并校验备份。口令不对、文件被改动、内容不合格都会在这里明确拒绝，且不改动当前数据 */
  async inspectBackup(password: string): Promise<RestorePreview | null> {
    const path = await this.d.pickOpen();
    if (!path) return null;
    if (statSync(path).size > MAX_BACKUP_FILE) throw new AppError("backup.invalid", "备份文件过大", {});
    this.cancelRestore();
    const prepared = await prepareRestore(await readFile(path), password, this.d.dirs.tmp);
    this.pending = { prepared, fileName: basename(path) };
    return { fileName: basename(path), createdAt: prepared.meta.createdAt, appVersion: prepared.meta.appVersion, caseCount: prepared.caseCount };
  }

  cancelRestore(): void {
    if (!this.pending) return;
    for (const suf of ["", "-wal", "-shm"]) rmSync(this.pending.prepared.dbPath + suf, { force: true });
    this.pending = null;
  }

  /** 执行恢复：关闭当前库，把当前数据移到 pre-restore，换入备份。调用方随后应重启应用 */
  commitRestore(): void {
    if (!this.pending) throw new AppError("backup.noPending", "没有待恢复的备份，请先选择备份文件", {});
    const { prepared } = this.pending;
    if (this.store) {
      this.store.logEvent("backup.restore", { backupCreatedAt: prepared.meta.createdAt, backupVersion: prepared.meta.appVersion });
      this.close();
    }
    applyRestore({ dbPath: this.d.dirs.db, keystorePath: this.d.dirs.keystore, restored: prepared, box: this.d.box, backupDir: this.d.dirs.backups });
    this.pending = null;
  }

  setAuto(input: { enabled?: boolean; keep?: number }): SecurityStatus {
    const s = this.need();
    if (input.keep !== undefined) {
      if (!Number.isInteger(input.keep) || input.keep < 1 || input.keep > 60) throw new AppError("ipc.invalidParam", "参数无效：keep", { what: "keep" });
      s.setSetting(K.autoKeep, String(input.keep));
    }
    if (input.enabled !== undefined) s.setSetting(K.autoEnabled, input.enabled ? "1" : "0");
    return this.status();
  }

  runAutoNow(): SecurityStatus {
    const s = this.need();
    runAutoBackup(s, this.d.dirs.autoBackups, { keep: Number(s.getSetting(K.autoKeep)) || DEFAULT_AUTO_KEEP });
    return this.status();
  }

  /** 启用且距上次快照超过 24 小时才生成；返回是否生成了 */
  maybeAuto(now = new Date()): boolean {
    const s = this.store;
    if (!s || s.getSetting(K.autoEnabled) === "0" || !autoBackupDue(this.d.dirs.autoBackups, now)) return false;
    this.runAutoNow();
    return true;
  }
}
