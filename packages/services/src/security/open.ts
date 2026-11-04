import { existsSync, mkdirSync, renameSync, copyFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError } from "@lc/core";
import { AesGcmCipher, CaseStore, inspectDatabase } from "@lc/storage";
import type { SecretBox } from "../ai";
import { loadOrCreateDataKey } from "./keyring";

/** 数据库打不开（锁定）的原因；应用进入恢复模式，引导用户从备份恢复 */
export type LockReason = "keyUnreadable" | "keyMissing" | "wrongKey" | "corrupt";

export type OpenResult =
  | { ok: true; store: CaseStore; key: Buffer; firstRun: boolean; migrated: boolean }
  | { ok: false; reason: LockReason; message: string };

const LOCK_CODES: Record<string, LockReason> = {
  "key.unreadable": "keyUnreadable",
  "key.missing": "keyMissing",
  "db.wrongKey": "wrongKey",
  "db.keyRequired": "wrongKey",
  "db.decryptFailed": "corrupt",
};

/**
 * 打开（必要时创建/迁移）加密数据库。
 * - 全新安装：生成数据密钥并建库
 * - 旧的明文库：在事务里整体加密（迁移）
 * - 密钥读不出 / 缺失 / 不匹配：不碰数据，返回 ok:false 让应用进入恢复模式
 * 其他错误（如系统加密不可用）原样抛出，由调用方当作致命错误处理——绝不退化为明文存储。
 */
export function openEncryptedStore(args: { dbPath: string; keystorePath: string; box: SecretBox }): OpenResult {
  const before = inspectDatabase(args.dbPath);
  try {
    const { key, created } = loadOrCreateDataKey(args.keystorePath, args.box, { hasEncryptedDb: before.encrypted });
    const store = new CaseStore(args.dbPath, { cipher: new AesGcmCipher(key) });
    return { ok: true, store, key, firstRun: created && !before.exists, migrated: before.exists && !before.encrypted };
  } catch (e) {
    const reason = e instanceof AppError ? LOCK_CODES[e.code] : undefined;
    if (reason) return { ok: false, reason, message: (e as AppError).message };
    throw e;
  }
}

const SIDE = ["", "-wal", "-shm"] as const;

/**
 * 旧版本的数据目录迁移：把旧目录里的数据库（含 -wal/-shm）移到新目录。
 * 用「移动」而非「复制」，这样旧位置不会留下一份明文数据库；新目录已有数据库时不覆盖。
 */
export function migrateLegacyData(oldDir: string, newDir: string): { moved: string[] } {
  const moved: string[] = [];
  const oldDb = join(oldDir, "lc.db");
  const newDb = join(newDir, "lc.db");
  if (!existsSync(oldDb) || existsSync(newDb)) return { moved };
  mkdirSync(newDir, { recursive: true });
  for (const suf of SIDE) {
    const from = oldDb + suf;
    const to = newDb + suf;
    if (!existsSync(from)) continue;
    try {
      renameSync(from, to);
    } catch {
      // 跨卷无法 rename：复制后删除原文件
      copyFileSync(from, to);
      rmSync(from, { force: true });
    }
    moved.push(`lc.db${suf}`);
  }
  return { moved };
}

/** 供应用在目录不存在时提前建好 */
export const ensureDir = (dir: string) => mkdirSync(dirname(join(dir, "x")), { recursive: true });
