import { createCipheriv, createDecipheriv, randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { AppError } from "@lc/core";

/**
 * 加密备份文件格式（.lcbak）：
 *   "LCBK" | 版本(1) | 盐(16) | IV(12) | GCM 标签(16) | 密文
 * 密钥由口令经 scrypt 派生；文件头参与认证。明文部分 = 4 字节元数据长度 | 元数据 JSON | 数据库快照。
 * 元数据里带着数据密钥，所以备份可以在另一台电脑上、仅凭口令恢复。
 */
const MAGIC = Buffer.from("LCBK");
const VERSION = 1;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 1 + SALT_LEN;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const;

const scryptAsync = promisify(scrypt) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

export const MIN_PASSWORD_LEN = 8;

export interface BackupMeta {
  createdAt: string;
  appVersion: string;
  dbBytes: number;
  /** base64 的数据密钥 */
  dataKey: string;
}

export function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LEN) throw new AppError("backup.weakPassword", `备份口令至少 ${MIN_PASSWORD_LEN} 个字符`, { min: MIN_PASSWORD_LEN });
}

const derive = (password: string, salt: Buffer) => scryptAsync(password.normalize("NFKC"), salt, 32, SCRYPT);

export async function encryptBackup(input: { dbBytes: Uint8Array; dataKey: Uint8Array; password: string; appVersion: string; createdAt: string }): Promise<Uint8Array> {
  validatePassword(input.password);
  const meta: BackupMeta = { createdAt: input.createdAt, appVersion: input.appVersion, dbBytes: input.dbBytes.length, dataKey: Buffer.from(input.dataKey).toString("base64") };
  const metaJson = Buffer.from(JSON.stringify(meta), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(metaJson.length);
  const plain = Buffer.concat([len, metaJson, input.dbBytes]);

  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), salt]);
  const c = createCipheriv("aes-256-gcm", await derive(input.password, salt), iv);
  c.setAAD(header);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([header, iv, c.getAuthTag(), ct]);
}

/** 口令不对与文件被改动在密码学上无法区分，统一报 backup.wrongPassword；不是备份文件则报 backup.invalid */
export async function decryptBackup(bytes: Uint8Array, password: string): Promise<{ meta: BackupMeta; dbBytes: Uint8Array; dataKey: Uint8Array }> {
  const buf = Buffer.from(bytes);
  if (buf.length < HEADER_LEN + IV_LEN + TAG_LEN + 4 || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new AppError("backup.invalid", "这不是有效的备份文件", {});
  }
  if (buf[MAGIC.length] !== VERSION) throw new AppError("backup.unsupportedVersion", "备份文件版本不受支持", { version: buf[MAGIC.length] ?? 0 });

  const header = buf.subarray(0, HEADER_LEN);
  const iv = buf.subarray(HEADER_LEN, HEADER_LEN + IV_LEN);
  const tag = buf.subarray(HEADER_LEN + IV_LEN, HEADER_LEN + IV_LEN + TAG_LEN);
  const ct = buf.subarray(HEADER_LEN + IV_LEN + TAG_LEN);

  let plain: Buffer;
  try {
    const d = createDecipheriv("aes-256-gcm", await derive(password, header.subarray(MAGIC.length + 1)), iv);
    d.setAAD(header);
    d.setAuthTag(tag);
    plain = Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new AppError("backup.wrongPassword", "口令不对，或备份文件已损坏", {});
  }

  const metaLen = plain.readUInt32BE(0);
  if (metaLen > plain.length - 4) throw new AppError("backup.invalid", "备份文件内容已损坏", {});
  const meta = JSON.parse(plain.subarray(4, 4 + metaLen).toString("utf8")) as BackupMeta;
  const dbBytes = plain.subarray(4 + metaLen);
  if (dbBytes.length !== meta.dbBytes) throw new AppError("backup.invalid", "备份文件内容已损坏", {});
  return { meta, dbBytes, dataKey: Buffer.from(meta.dataKey, "base64") };
}
