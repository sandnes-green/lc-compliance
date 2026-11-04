import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AesGcmCipher, CaseStore, generateDataKey, inspectDatabase } from "@lc/storage";
import { migrateLegacyData, openEncryptedStore, saveDataKey, type SecretBox } from "../src";

const boxFor = (user: string): SecretBox => ({
  encrypt: (p) => `${user}|${Buffer.from(p).toString("base64")}`,
  decrypt: (e) => {
    const [u, b] = e.split("|");
    if (u !== user) throw new Error("not this user");
    return Buffer.from(b!, "base64").toString();
  },
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lc-open-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const dbPath = () => join(dir, "lc.db");
const keystorePath = () => join(dir, "keystore.json");
const LC = ":20:OPEN1\n:32B:USD1,00";

describe("openEncryptedStore", () => {
  it("全新安装：生成密钥、建库，数据库为加密状态；再次打开读到同一份数据", () => {
    const r = openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("a") });
    if (!r.ok) throw new Error("应成功");
    expect(r.firstRun).toBe(true);
    expect(r.migrated).toBe(false);
    r.store.createCase({ name: "案件", lcText: LC });
    r.store.close();
    expect(inspectDatabase(dbPath()).encrypted).toBe(true);

    const again = openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("a") });
    if (!again.ok) throw new Error("应成功");
    expect(again.firstRun).toBe(false);
    expect(again.store.listCases()[0]!.name).toBe("案件");
    again.store.close();
  });

  it("旧的明文库：自动迁移为加密，数据保留", () => {
    const old = new CaseStore(dbPath());
    old.createCase({ name: "旧案件-LEGACY-5566", lcText: LC });
    old.close();
    expect(readFileSync(dbPath()).includes(Buffer.from("LEGACY-5566"))).toBe(true);

    const r = openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("a") });
    if (!r.ok) throw new Error("应成功");
    expect(r.migrated).toBe(true);
    expect(r.firstRun).toBe(false);
    expect(r.store.listCases()[0]!.name).toBe("旧案件-LEGACY-5566");
    r.store.close();
    expect(readFileSync(dbPath()).includes(Buffer.from("LEGACY-5566"))).toBe(false);
  });

  it("换了 Windows 用户（密钥解不开）→ 锁定，原数据与原密钥文件不动", () => {
    const a = openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("alice") });
    if (!a.ok) throw new Error("应成功");
    a.store.createCase({ name: "x", lcText: LC });
    a.store.close();
    const dbBefore = readFileSync(dbPath());
    const ksBefore = readFileSync(keystorePath(), "utf8");

    const r = openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("bob") });
    expect(r).toMatchObject({ ok: false, reason: "keyUnreadable" });
    expect(readFileSync(keystorePath(), "utf8")).toBe(ksBefore);
    expect(readFileSync(dbPath()).equals(dbBefore)).toBe(true);
  });

  it("数据库已加密但密钥文件丢了 → 锁定（keyMissing），不会新建密钥", () => {
    const a = openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("a") });
    if (!a.ok) throw new Error("应成功");
    a.store.close();
    rmSync(keystorePath());
    expect(openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("a") })).toMatchObject({ ok: false, reason: "keyMissing" });
    expect(existsSync(keystorePath())).toBe(false);
  });

  it("密钥文件里的密钥与数据库不匹配 → 锁定（wrongKey），并释放数据库文件句柄", () => {
    const a = openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("a") });
    if (!a.ok) throw new Error("应成功");
    a.store.close();
    saveDataKey(keystorePath(), boxFor("a"), generateDataKey());
    expect(openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: boxFor("a") })).toMatchObject({ ok: false, reason: "wrongKey" });
    rmSync(dbPath()); // 句柄已释放：Windows 上被占用的文件无法删除
    expect(existsSync(dbPath())).toBe(false);
  });

  it("系统加密不可用等其他错误原样抛出，绝不退化为明文存储", () => {
    const broken: SecretBox = { encrypt: () => { throw new Error("DPAPI 不可用"); }, decrypt: () => "" };
    expect(() => openEncryptedStore({ dbPath: dbPath(), keystorePath: keystorePath(), box: broken })).toThrow("DPAPI 不可用");
    expect(existsSync(dbPath())).toBe(false);
  });
});

describe("migrateLegacyData", () => {
  const oldDir = () => join(dir, "old");
  const newDir = () => join(dir, "new");

  it("把旧目录的数据库（含 wal/shm）移到新目录，旧位置不留文件", () => {
    mkdirSync(oldDir());
    writeFileSync(join(oldDir(), "lc.db"), "DB");
    writeFileSync(join(oldDir(), "lc.db-wal"), "WAL");
    const r = migrateLegacyData(oldDir(), newDir());
    expect(r.moved).toEqual(["lc.db", "lc.db-wal"]);
    expect(readFileSync(join(newDir(), "lc.db"), "utf8")).toBe("DB");
    expect(readFileSync(join(newDir(), "lc.db-wal"), "utf8")).toBe("WAL");
    expect(existsSync(join(oldDir(), "lc.db"))).toBe(false);
    expect(existsSync(join(oldDir(), "lc.db-wal"))).toBe(false);
  });

  it("新目录已有数据库、或旧目录没有数据库：什么都不做", () => {
    expect(migrateLegacyData(oldDir(), newDir()).moved).toEqual([]);
    mkdirSync(oldDir());
    mkdirSync(newDir());
    writeFileSync(join(oldDir(), "lc.db"), "OLD");
    writeFileSync(join(newDir(), "lc.db"), "NEW");
    expect(migrateLegacyData(oldDir(), newDir()).moved).toEqual([]);
    expect(readFileSync(join(newDir(), "lc.db"), "utf8")).toBe("NEW");
    expect(readFileSync(join(oldDir(), "lc.db"), "utf8")).toBe("OLD");
  });

  it("迁移后用加密方式打开：真实的「升级」路径", () => {
    mkdirSync(oldDir());
    const old = new CaseStore(join(oldDir(), "lc.db"));
    old.createCase({ name: "升级前的案件", lcText: LC });
    old.close();
    migrateLegacyData(oldDir(), newDir());
    const r = openEncryptedStore({ dbPath: join(newDir(), "lc.db"), keystorePath: join(newDir(), "keystore.json"), box: boxFor("a") });
    if (!r.ok) throw new Error("应成功");
    expect(r.migrated).toBe(true);
    expect(r.store.listCases()[0]!.name).toBe("升级前的案件");
    expect(existsSync(join(oldDir(), "lc.db"))).toBe(false);
    r.store.close();
  });
});
