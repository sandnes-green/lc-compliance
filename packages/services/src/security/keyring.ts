import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AppError } from "@lc/core";
import { generateDataKey, KEY_LEN } from "@lc/storage";
import type { SecretBox } from "../ai";

/**
 * 数据密钥的保管：密钥文件里存的是被系统（Windows DPAPI，经 SecretBox）加密过的密钥，
 * 只有同一个 Windows 用户能解开。更换电脑或重装系统后，需要用口令保护的备份来恢复。
 */
interface KeystoreFile {
  v: 1;
  wrapped: string;
}

const writeAtomic = (path: string, data: string) => {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
};

export function saveDataKey(path: string, box: SecretBox, key: Uint8Array): void {
  const file: KeystoreFile = { v: 1, wrapped: box.encrypt(Buffer.from(key).toString("base64")) };
  writeAtomic(path, JSON.stringify(file));
}

/** 读取数据密钥；密钥文件存在但解不开（如换了 Windows 用户）时抛 key.unreadable，绝不悄悄新建密钥覆盖 */
export function loadDataKey(path: string, box: SecretBox): Buffer {
  let key: Buffer;
  try {
    const file = JSON.parse(readFileSync(path, "utf8")) as KeystoreFile;
    key = Buffer.from(box.decrypt(file.wrapped), "base64");
  } catch {
    throw new AppError("key.unreadable", "无法读取数据密钥（可能换了 Windows 用户或电脑），请从备份恢复", {});
  }
  if (key.length !== KEY_LEN) throw new AppError("key.unreadable", "数据密钥已损坏，请从备份恢复", {});
  return key;
}

/**
 * 取得数据密钥。首次运行（没有密钥文件）才会生成新密钥；
 * `hasExistingDb` 为真而密钥文件缺失时拒绝新建——否则会用一把新密钥去「打开」旧库，造成数据永久不可读。
 */
export function loadOrCreateDataKey(path: string, box: SecretBox, opts: { hasEncryptedDb: boolean }): { key: Buffer; created: boolean } {
  if (existsSync(path)) return { key: loadDataKey(path, box), created: false };
  if (opts.hasEncryptedDb) throw new AppError("key.missing", "找不到数据密钥文件，而数据库已加密，请从备份恢复", {});
  const key = generateDataKey();
  saveDataKey(path, box, key);
  return { key, created: true };
}
