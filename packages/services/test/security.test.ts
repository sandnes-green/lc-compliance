import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AesGcmCipher, CaseStore, generateDataKey } from "@lc/storage";
import {
  MIN_PASSWORD_LEN,
  applyRestore,
  autoBackupDue,
  createBackupFile,
  decryptBackup,
  encryptBackup,
  listAutoBackups,
  loadDataKey,
  loadOrCreateDataKey,
  prepareRestore,
  runAutoBackup,
  saveDataKey,
  stamp,
  type SecretBox,
} from "../src";

// 模拟 DPAPI：只有「同一个用户」（这里用同一个盐）能解开
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
  dir = mkdtempSync(join(tmpdir(), "lc-sec-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const SECRET = "绝密案件-SECRET-4242";
const LC = ":20:SEC1\n:32B:USD1000,00";

function makeDb(file: string, key: Uint8Array) {
  const s = new CaseStore(file, { cipher: new AesGcmCipher(key) });
  s.createCase({ name: SECRET, lcText: LC });
  return s;
}

describe("备份文件格式", () => {
  const db = randomBytes(100_000);
  const key = generateDataKey();
  const enc = (password = "correct horse") => encryptBackup({ dbBytes: db, dataKey: key, password, appVersion: "1.2.3", createdAt: "2026-01-01T00:00:00.000Z" });

  it("往返：数据库、密钥、元数据都原样还原", async () => {
    const r = await decryptBackup(await enc(), "correct horse");
    expect(Buffer.from(r.dbBytes).equals(db)).toBe(true);
    expect(Buffer.from(r.dataKey).equals(key)).toBe(true);
    expect(r.meta).toMatchObject({ appVersion: "1.2.3", createdAt: "2026-01-01T00:00:00.000Z", dbBytes: db.length });
  });

  it("口令错误、文件任意位置被改动，都明确拒绝", async () => {
    const good = Buffer.from(await enc());
    await expect(decryptBackup(good, "wrong password")).rejects.toMatchObject({ code: "backup.wrongPassword" });
    for (const pos of [6, 25, 40, 60, good.length - 1]) {
      const bad = Buffer.from(good);
      bad[pos]! ^= 0xff;
      await expect(decryptBackup(bad, "correct horse"), `改动第 ${pos} 字节`).rejects.toMatchObject({ code: "backup.wrongPassword" });
    }
  });

  it("不是备份、被截断、版本不认识", async () => {
    await expect(decryptBackup(new TextEncoder().encode("hello world, not a backup at all......"), "x")).rejects.toMatchObject({ code: "backup.invalid" });
    await expect(decryptBackup((await enc()).slice(0, 20), "correct horse")).rejects.toMatchObject({ code: "backup.invalid" });
    const v2 = Buffer.from(await enc());
    v2[4] = 2;
    await expect(decryptBackup(v2, "correct horse")).rejects.toMatchObject({ code: "backup.unsupportedVersion" });
  });

  it("口令太短拒绝；每次加密的盐与 IV 不同；全角字符口令与半角等价", async () => {
    await expect(enc("short")).rejects.toMatchObject({ code: "backup.weakPassword" });
    expect(MIN_PASSWORD_LEN).toBe(8);
    const a = await enc("password1234");
    const b = await enc("password1234");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    await expect(decryptBackup(a, "ｐａｓｓｗｏｒｄ１２３４")).resolves.toBeDefined();
  });

  it("密文里看不到数据库内容", async () => {
    const marked = Buffer.concat([Buffer.from("PLAINTEXT-MARKER-XYZ"), db]);
    const out = Buffer.from(await encryptBackup({ dbBytes: marked, dataKey: key, password: "correct horse", appVersion: "1", createdAt: "t" }));
    expect(out.includes(Buffer.from("PLAINTEXT-MARKER-XYZ"))).toBe(false);
  });
});

describe("密钥保管", () => {
  const box = boxFor("alice");
  const ks = () => join(dir, "keystore.json");

  it("首次运行生成密钥并保存，之后读到同一把；文件里没有明文密钥", () => {
    const a = loadOrCreateDataKey(ks(), box, { hasEncryptedDb: false });
    expect(a.created).toBe(true);
    expect(a.key.length).toBe(32);
    expect(readFileSync(ks(), "utf8")).not.toContain(a.key.toString("base64"));
    const b = loadOrCreateDataKey(ks(), box, { hasEncryptedDb: true });
    expect(b.created).toBe(false);
    expect(b.key.equals(a.key)).toBe(true);
  });

  it("换了用户（解不开）、文件损坏、密钥长度不对 → key.unreadable，不会悄悄生成新密钥", () => {
    const { key } = loadOrCreateDataKey(ks(), box, { hasEncryptedDb: false });
    const before = readFileSync(ks(), "utf8");
    expect(() => loadDataKey(ks(), boxFor("bob"))).toThrowError(expect.objectContaining({ code: "key.unreadable" }));
    expect(() => loadOrCreateDataKey(ks(), boxFor("bob"), { hasEncryptedDb: true })).toThrowError(expect.objectContaining({ code: "key.unreadable" }));
    expect(readFileSync(ks(), "utf8")).toBe(before); // 原文件未被覆盖
    writeFileSync(ks(), "{not json");
    expect(() => loadDataKey(ks(), box)).toThrowError(expect.objectContaining({ code: "key.unreadable" }));
    saveDataKey(ks(), box, key.subarray(0, 16));
    expect(() => loadDataKey(ks(), box)).toThrowError(expect.objectContaining({ code: "key.unreadable" }));
  });

  it("数据库已加密而密钥文件缺失：拒绝新建密钥（否则旧数据永久不可读）", () => {
    expect(() => loadOrCreateDataKey(ks(), box, { hasEncryptedDb: true })).toThrowError(expect.objectContaining({ code: "key.missing" }));
    expect(existsSync(ks())).toBe(false);
  });
});

describe("导出备份与恢复校验", () => {
  const key = generateDataKey();
  const dbFile = () => join(dir, "lc.db");

  async function backup(password = "correct horse") {
    const s = makeDb(dbFile(), key);
    const out = join(dir, "x.lcbak");
    const r = await createBackupFile(s, { dataKey: key, password, outPath: out, appVersion: "9.9.9", tmpDir: join(dir, "tmp") });
    s.close();
    return { out, r };
  }

  it("导出的文件看不到明文；临时快照被清理", async () => {
    const { out, r } = await backup();
    expect(r.bytes).toBeGreaterThan(1000);
    expect(readFileSync(out).includes(Buffer.from(SECRET))).toBe(false);
    expect(readdirSync(join(dir, "tmp"))).toEqual([]);
  });

  it("校验通过：给出案件数量，临时库能用备份里的密钥打开", async () => {
    const { out } = await backup();
    const p = await prepareRestore(readFileSync(out), "correct horse", join(dir, "work"));
    expect(p.caseCount).toBe(1);
    expect(p.meta.appVersion).toBe("9.9.9");
    const s = new CaseStore(p.dbPath, { cipher: new AesGcmCipher(p.dataKey) });
    expect(s.listCases()[0]!.name).toBe(SECRET);
    s.close();
  });

  it("口令不对：拒绝，且不在工作目录留下任何文件", async () => {
    const { out } = await backup();
    await expect(prepareRestore(readFileSync(out), "wrong password", join(dir, "work"))).rejects.toMatchObject({ code: "backup.wrongPassword" });
    expect(existsSync(join(dir, "work")) ? readdirSync(join(dir, "work")) : []).toEqual([]);
  });

  it("口令对但内容不合格：未加密的库、密钥对不上的库、审计链被破坏的库，都拒绝并清理", async () => {
    const work = join(dir, "work");
    const bytes = (f: string) => readFileSync(f);

    // 1. 明文库
    const plain = new CaseStore(join(dir, "plain.db"));
    plain.createCase({ name: "x", lcText: LC });
    plain.backupTo(join(dir, "plain.snap"));
    plain.close();
    const b1 = await encryptBackup({ dbBytes: bytes(join(dir, "plain.snap")), dataKey: key, password: "correct horse", appVersion: "1", createdAt: "t" });
    await expect(prepareRestore(b1, "correct horse", work)).rejects.toMatchObject({ code: "backup.invalid" });

    // 2. 库用 A 密钥加密，备份里带的却是 B 密钥
    const enc = makeDb(join(dir, "enc.db"), key);
    enc.backupTo(join(dir, "enc.snap"));
    enc.close();
    const b2 = await encryptBackup({ dbBytes: bytes(join(dir, "enc.snap")), dataKey: generateDataKey(), password: "correct horse", appVersion: "1", createdAt: "t" });
    await expect(prepareRestore(b2, "correct horse", work)).rejects.toMatchObject({ code: "backup.invalid" });

    // 3. 审计链被破坏
    const tam = makeDb(join(dir, "tam.db"), key);
    tam._unsafeExec(`UPDATE audit_log SET detail_json = 'x' WHERE id = 1`);
    tam.backupTo(join(dir, "tam.snap"));
    tam.close();
    const b3 = await encryptBackup({ dbBytes: bytes(join(dir, "tam.snap")), dataKey: key, password: "correct horse", appVersion: "1", createdAt: "t" });
    await expect(prepareRestore(b3, "correct horse", work)).rejects.toMatchObject({ code: "backup.invalid" });

    expect(readdirSync(work)).toEqual([]);
  });
});

describe("applyRestore", () => {
  const box = boxFor("alice");
  const oldKey = generateDataKey();
  const newKey = generateDataKey();
  const paths = () => ({ dbPath: join(dir, "lc.db"), keystorePath: join(dir, "keystore.json"), backupDir: join(dir, "backups") });

  function setup() {
    const p = paths();
    // 当前数据（旧密钥）
    const cur = new CaseStore(p.dbPath, { cipher: new AesGcmCipher(oldKey) });
    cur.createCase({ name: "当前数据", lcText: LC });
    cur.close();
    saveDataKey(p.keystorePath, box, oldKey);
    // 备份里的数据（新密钥）
    const rest = new CaseStore(join(dir, "restored.db"), { cipher: new AesGcmCipher(newKey) });
    rest.createCase({ name: "备份数据", lcText: LC });
    rest.close();
    return { ...p, restored: { dbPath: join(dir, "restored.db"), dataKey: newKey } };
  }

  it("替换为备份数据；当前数据与旧密钥都保留，随时可以换回", () => {
    const a = setup();
    const r = applyRestore({ ...a, box, now: new Date(2026, 0, 2, 3, 4, 5) });
    expect(r.preRestoreDb).toContain("pre-restore-20260102-030405.db");

    const now = new CaseStore(a.dbPath, { cipher: new AesGcmCipher(loadDataKey(a.keystorePath, box)) });
    expect(now.listCases()[0]!.name).toBe("备份数据");
    now.close();

    const old = new CaseStore(r.preRestoreDb, { cipher: new AesGcmCipher(loadDataKey(r.preRestoreKeystore!, box)) });
    expect(old.listCases()[0]!.name).toBe("当前数据");
    old.close();
    expect(existsSync(a.restored.dbPath)).toBe(false);
  });

  it("中途失败（如写密钥失败）：回滚到恢复前的状态", () => {
    const a = setup();
    const broken: SecretBox = { encrypt: () => { throw new Error("DPAPI 不可用"); }, decrypt: box.decrypt };
    expect(() => applyRestore({ ...a, box: broken })).toThrowError(expect.objectContaining({ code: "backup.restoreFailed" }));
    const s = new CaseStore(a.dbPath, { cipher: new AesGcmCipher(loadDataKey(a.keystorePath, box)) });
    expect(s.listCases()[0]!.name).toBe("当前数据");
    s.close();
  });
});

describe("自动本地快照", () => {
  const key = generateDataKey();

  it("按时间间隔判断是否需要；只保留最近 N 份；快照可用同一密钥打开", () => {
    const s = makeDb(join(dir, "lc.db"), key);
    const bdir = join(dir, "auto");
    expect(autoBackupDue(bdir, new Date())).toBe(true);

    const t0 = new Date(2026, 0, 1, 10, 0, 0);
    for (let i = 0; i < 4; i++) runAutoBackup(s, bdir, { keep: 2, now: new Date(t0.getTime() + i * 1000) });
    const list = listAutoBackups(bdir);
    expect(list.map((x) => x.name)).toEqual(["auto-20260101-100003.db", "auto-20260101-100002.db"]);

    // 刚做过 → 不需要；mtime 已超过 24 小时 → 需要
    expect(autoBackupDue(bdir, new Date())).toBe(false);
    const old = new Date(Date.now() - 25 * 3600_000);
    for (const f of list) utimesSync(f.path, old, old);
    expect(autoBackupDue(bdir, new Date())).toBe(true);

    const snap = new CaseStore(list[0]!.path, { cipher: new AesGcmCipher(key) });
    expect(snap.listCases()[0]!.name).toBe(SECRET);
    snap.close();
    s.close();
  });

  it("同一秒内重复触发不会重复生成或报错；文件名用本地时间", () => {
    const s = makeDb(join(dir, "lc.db"), key);
    const now = new Date(2026, 5, 7, 8, 9, 10);
    const a = runAutoBackup(s, join(dir, "auto"), { keep: 3, now });
    const b = runAutoBackup(s, join(dir, "auto"), { keep: 3, now });
    expect(b.created).toBe(a.created);
    expect(a.created.endsWith("auto-20260607-080910.db")).toBe(true);
    expect(stamp(now)).toBe("20260607-080910");
    s.close();
  });
});
