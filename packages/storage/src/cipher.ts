import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@lc/core";

/**
 * 字段级加密。数据库里的敏感内容（单据与手册原文、案件数据、审查结果、外发日志等）以密文存放，
 * 即使数据库文件被复制走，没有密钥也读不出内容。
 *
 * 每个值使用独立的随机 IV；「表名.列名」作为认证数据（AAD）参与校验，
 * 因此密文被挪到别的列、或被篡改，都会解密失败而不是被悄悄接受。
 */
export interface Cipher {
  readonly enabled: boolean;
  seal(aad: string, plain: string): string;
  /** 解开 seal 的结果；失败（密钥错误、数据被篡改）抛出 db.decryptFailed */
  open(aad: string, sealed: string): string;
}

/** 不加密（测试与未配置密钥时使用） */
export const plainCipher: Cipher = {
  enabled: false,
  seal: (_aad, plain) => plain,
  open: (_aad, value) => value,
};

export const SEAL_PREFIX = "enc1:";
const IV_LEN = 12;
const TAG_LEN = 16;
export const KEY_LEN = 32;

export function generateDataKey(): Buffer {
  return randomBytes(KEY_LEN);
}

export class AesGcmCipher implements Cipher {
  readonly enabled = true;
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (key.length !== KEY_LEN) throw new AppError("key.invalid", `数据密钥长度应为 ${KEY_LEN} 字节`, {});
    this.key = Buffer.from(key);
  }

  seal(aad: string, plain: string): string {
    const iv = randomBytes(IV_LEN);
    const c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(aad, "utf8"));
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return SEAL_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
  }

  open(aad: string, sealed: string): string {
    if (!sealed.startsWith(SEAL_PREFIX)) throw new AppError("db.decryptFailed", "数据未加密或已损坏", { where: aad });
    try {
      const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64");
      if (raw.length < IV_LEN + TAG_LEN) throw new Error("too short");
      const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, IV_LEN));
      d.setAAD(Buffer.from(aad, "utf8"));
      d.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
      return Buffer.concat([d.update(raw.subarray(IV_LEN + TAG_LEN)), d.final()]).toString("utf8");
    } catch {
      throw new AppError("db.decryptFailed", "数据解密失败：密钥不对，或数据已被篡改", { where: aad });
    }
  }
}
