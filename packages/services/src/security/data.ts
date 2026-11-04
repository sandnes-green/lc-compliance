import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "@lc/core";
import { AesGcmCipher, CaseStore, inspectDatabase } from "@lc/storage";
import type { SecretBox } from "../ai";
import { decryptBackup, encryptBackup, type BackupMeta } from "./backup-format";
import { saveDataKey } from "./keyring";

const pad = (n: number) => String(n).padStart(2, "0");
/** 本地时间的 YYYYMMDD-HHmmss，用于文件名 */
export const stamp = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

const writeAtomic = (path: string, data: Uint8Array) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
};

// ───────────── 口令保护的备份（可在另一台电脑恢复） ─────────────

/**
 * 导出加密备份：数据库一致性快照 + 数据密钥，整体用口令加密。
 * 先写临时文件再改名，因此不会留下写了一半的备份。
 */
export async function createBackupFile(
  store: CaseStore,
  args: { dataKey: Uint8Array; password: string; outPath: string; appVersion: string; tmpDir: string; now?: Date },
): Promise<{ path: string; bytes: number }> {
  mkdirSync(args.tmpDir, { recursive: true });
  const snap = join(args.tmpDir, `snapshot-${randomUUID()}.db`);
  try {
    store.backupTo(snap);
    const dbBytes = readFileSync(snap);
    const out = await encryptBackup({ dbBytes, dataKey: args.dataKey, password: args.password, appVersion: args.appVersion, createdAt: (args.now ?? new Date()).toISOString() });
    writeAtomic(args.outPath, out);
    return { path: args.outPath, bytes: out.length };
  } finally {
    rmSync(snap, { force: true });
  }
}

export interface PreparedRestore {
  /** 已解出并校验通过的数据库临时文件 */
  dbPath: string;
  dataKey: Uint8Array;
  meta: BackupMeta;
  /** 备份里的案件数量，供用户确认 */
  caseCount: number;
}

/**
 * 校验备份：口令正确、文件未被改动、能用其中的密钥打开、库结构与审计链完整。
 * 任何一步失败都不会动当前数据。通过后返回临时库路径，等用户确认再 applyRestore。
 */
export async function prepareRestore(bytes: Uint8Array, password: string, workDir: string): Promise<PreparedRestore> {
  const { meta, dbBytes, dataKey } = await decryptBackup(bytes, password);
  mkdirSync(workDir, { recursive: true });
  const dbPath = join(workDir, `restore-${randomUUID()}.db`);
  writeFileSync(dbPath, dbBytes);
  try {
    // 先看标记：未加密的库带着密钥打开会被「顺手」加密迁移，那会让一份明文备份蒙混过关
    if (!inspectDatabase(dbPath).encrypted) throw new AppError("backup.invalid", "备份里的数据库未加密，拒绝恢复", {});
    let store: CaseStore;
    try {
      store = new CaseStore(dbPath, { cipher: new AesGcmCipher(dataKey) });
    } catch (e) {
      throw new AppError("backup.invalid", "备份里的数据库无法打开", { detail: e instanceof Error ? e.message : String(e) });
    }
    try {
      if (!store.encrypted) throw new AppError("backup.invalid", "备份里的数据库未加密，拒绝恢复", {});
      const check = store.verifyIntegrity();
      if (!check.ok) throw new AppError("backup.invalid", "备份里的数据库未通过完整性检查", { detail: check.problems.join("; ") });
      return { dbPath, dataKey, meta, caseCount: store.listCases().length };
    } finally {
      store.close();
    }
  } catch (e) {
    rmSync(dbPath, { force: true });
    rmSync(dbPath + "-wal", { force: true });
    rmSync(dbPath + "-shm", { force: true });
    throw e;
  }
}

const SIDE = ["", "-wal", "-shm"] as const;

/**
 * 用校验过的备份替换当前数据库。调用前必须已关闭当前库。
 * 当前数据不会被删除：数据库与密钥文件都移到 backupDir 下（pre-restore-*），需要时可手工换回。
 * 中途任何一步失败都会尽量回滚到替换前的状态。
 */
export function applyRestore(args: { dbPath: string; keystorePath: string; restored: Pick<PreparedRestore, "dbPath" | "dataKey">; box: SecretBox; backupDir: string; now?: Date }): { preRestoreDb: string; preRestoreKeystore: string | null } {
  mkdirSync(args.backupDir, { recursive: true });
  const ts = stamp(args.now ?? new Date());
  const preDb = join(args.backupDir, `pre-restore-${ts}.db`);
  const preKey = join(args.backupDir, `keystore.pre-restore-${ts}.json`);
  const moved: [string, string][] = [];
  const undo = () => {
    for (const [from, to] of moved.reverse()) if (existsSync(from)) renameSync(from, to);
  };

  try {
    for (const suf of SIDE) {
      if (existsSync(args.dbPath + suf)) {
        renameSync(args.dbPath + suf, preDb + suf);
        moved.push([preDb + suf, args.dbPath + suf]);
      }
    }
    let preKeystore: string | null = null;
    if (existsSync(args.keystorePath)) {
      copyFileSync(args.keystorePath, preKey);
      preKeystore = preKey;
    }
    renameSync(args.restored.dbPath, args.dbPath);
    for (const suf of ["-wal", "-shm"] as const) rmSync(args.restored.dbPath + suf, { force: true });
    saveDataKey(args.keystorePath, args.box, args.restored.dataKey);
    return { preRestoreDb: preDb, preRestoreKeystore: preKeystore };
  } catch (e) {
    undo();
    throw new AppError("backup.restoreFailed", `恢复失败，已保持原有数据：${e instanceof Error ? e.message : String(e)}`, { detail: e instanceof Error ? e.message : String(e) });
  }
}

// ───────────── 自动本地快照（防损坏/误删；依赖本机密钥，不能跨机恢复） ─────────────

const AUTO_RE = /^auto-(\d{8}-\d{6})\.db$/;

export interface AutoBackupInfo {
  name: string;
  path: string;
  bytes: number;
  /** 文件修改时间 */
  at: string;
}

export function listAutoBackups(dir: string): AutoBackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => AUTO_RE.test(n))
    .map((name) => {
      const path = join(dir, name);
      const st = statSync(path);
      return { name, path, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name)); // 文件名含时间戳，倒序 = 新的在前
}

/** 距离最近一次自动快照是否已超过 intervalHours；一次都没有则需要 */
export function autoBackupDue(dir: string, now: Date, intervalHours = 24): boolean {
  const latest = listAutoBackups(dir)[0];
  return !latest || now.getTime() - new Date(latest.at).getTime() >= intervalHours * 3600_000;
}

/** 生成自动快照并只保留最近 keep 份 */
export function runAutoBackup(store: CaseStore, dir: string, opts: { keep: number; now?: Date }): { created: string; pruned: string[] } {
  mkdirSync(dir, { recursive: true });
  const created = join(dir, `auto-${stamp(opts.now ?? new Date())}.db`);
  if (existsSync(created)) return { created, pruned: [] }; // 同一秒内重复触发
  store.backupTo(created);
  const pruned: string[] = [];
  for (const old of listAutoBackups(dir).slice(Math.max(1, opts.keep))) {
    rmSync(old.path, { force: true });
    pruned.push(basename(old.path));
  }
  return { created, pruned };
}
