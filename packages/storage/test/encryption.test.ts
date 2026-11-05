import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AesGcmCipher, CaseStore, SECRET_COLUMNS, SEAL_PREFIX, generateDataKey, plainCipher, type Cipher } from "../src";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");

// 合成数据（非真实）。下列标记串绝不能以明文出现在数据库文件里
const MARK = {
  caseName: "绝密客户-ALPHA案件",
  lcRef: "LCREF-SECRET-7788",
  docText: "FREIGHT PREPAID 绝密货物清单 WIDGETS-9921",
  docName: "秘密发票-INV-4411.pdf",
  manualText: "内部审单规则：绝密条款 CLAUSE-5566",
  itemTitle: "内部检查项-TITLE-3344",
  quote: "手册依据-QUOTE-2288",
  llmSent: "发送给模型的机密-LLM-6677",
};
const LC_TEXT = `:20:${MARK.lcRef}\n:32B:USD1000,00\n:59:SANDNES TRADING CO LTD\n:47A:+DOCUMENTS IN ENGLISH`;

let dir: string;
let file: string;
const key = generateDataKey();
const cipher = new AesGcmCipher(key);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lc-enc-"));
  file = join(dir, "t.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 往每张表都写入带标记的数据 */
function populate(s: CaseStore) {
  const c = s.createCase({ name: MARK.caseName, lcText: LC_TEXT });
  s.savePresentation(c.id, { presentationDate: "2024-08-25", invoice: { sellerName: "SANDNES TRADING CO LTD", goodsDescription: MARK.docText } });
  const d = s.addDocument({ caseId: c.id, docType: "invoice", fileName: MARK.docName, sourceKind: "pdf", text: MARK.docText, chars: 30, needsOcr: false });
  s.saveExtraction(d.id, { fields: { currency: { value: "USD", quote: MARK.docText } }, rejected: [] });
  const m = s.addManual({ name: "公司审单清单", fileName: "list.txt", sourceKind: "text", text: MARK.manualText, chars: 30 });
  s.addCheckItems(
    [{ draft: { title: MARK.itemTitle, requirement: "要求-REQ-1199", kind: "text", scope: "invoice", severity: "doubt", textMatch: { mode: "all", phrases: ["PHRASE-8855"] } }, source: { manualId: m.id, manualName: "公司审单清单", quote: MARK.quote }, origin: "ai" }],
    "enabled",
  );
  s.logLlmCall({ at: "2026-01-01T00:00:00Z", provider: "deepseek", model: "m", attempt: 0, outcome: "ok", messages: [{ role: "user", content: MARK.llmSent }], response: "返回内容-RESP-1010" }, c.id);
  s.runCase(c.id);
  return { c, d, m };
}

const rawBytes = () => ["", "-wal"].map((suf) => (existsSync(file + suf) ? readFileSync(file + suf) : Buffer.alloc(0)));
const fileContains = (needle: string) => rawBytes().some((b) => b.includes(Buffer.from(needle, "utf8")));

describe("AesGcmCipher", () => {
  it("往返（含中文、空串、长文本），每次密文不同", () => {
    for (const plain of ["", "hello", "中文 + emoji 😀", "x".repeat(100_000)]) {
      const a = cipher.seal("t.c", plain);
      expect(a.startsWith(SEAL_PREFIX)).toBe(true);
      expect(cipher.open("t.c", a)).toBe(plain);
      expect(cipher.seal("t.c", plain)).not.toBe(a); // 随机 IV
    }
  });

  it("绑定「表.列」：挪到别的列、改一个字节、换密钥、没有前缀，都解密失败", () => {
    const sealed = cipher.seal("cases.name", "secret");
    expect(() => cipher.open("cases.lc_text", sealed)).toThrowError(expect.objectContaining({ code: "db.decryptFailed" }));
    const raw = Buffer.from(sealed.slice(SEAL_PREFIX.length), "base64");
    raw[raw.length - 1]! ^= 1;
    expect(() => cipher.open("cases.name", SEAL_PREFIX + raw.toString("base64"))).toThrowError(expect.objectContaining({ code: "db.decryptFailed" }));
    expect(() => new AesGcmCipher(generateDataKey()).open("cases.name", sealed)).toThrowError(expect.objectContaining({ code: "db.decryptFailed" }));
    expect(() => cipher.open("cases.name", "plaintext")).toThrowError(expect.objectContaining({ code: "db.decryptFailed" }));
    expect(() => cipher.open("cases.name", SEAL_PREFIX + "AA==")).toThrow();
  });

  it("密钥长度必须是 32 字节", () => {
    expect(() => new AesGcmCipher(new Uint8Array(16))).toThrowError(expect.objectContaining({ code: "key.invalid" }));
  });
});

describe("加密存储", () => {
  it("数据库文件里找不到任何明文标记（主文件与 WAL）", () => {
    const s = new CaseStore(file, { cipher });
    populate(s);
    s.close();
    for (const m of Object.values(MARK)) expect(fileContains(m), m).toBe(false);
    expect(fileContains("PHRASE-8855")).toBe(false);
    expect(fileContains("RESP-1010")).toBe(false);
    expect(fileContains("CLAUSE-5566")).toBe(false);
  });

  it("对照：不加密时同样的标记确实出现在文件里（说明上面的检查有效）", () => {
    const s = new CaseStore(file);
    populate(s);
    s.close();
    expect(fileContains(MARK.lcRef) || fileContains(MARK.docText)).toBe(true);
  });

  it("所有登记的加密列，库里每个非空值都是密文", () => {
    const s = new CaseStore(file, { cipher });
    populate(s);
    s.close();
    const raw = new DatabaseSync(file, { readOnly: true });
    for (const [table, cols] of Object.entries(SECRET_COLUMNS)) {
      for (const row of raw.prepare(`SELECT ${cols.join(",")} FROM ${table}`).all() as Record<string, unknown>[]) {
        for (const c of cols) if (row[c] !== null) expect(String(row[c]).startsWith(SEAL_PREFIX), `${table}.${c}`).toBe(true);
      }
      expect((raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n, `${table} 应有测试数据`).toBeGreaterThan(0);
    }
    raw.close();
  });

  it("闸门：数据库里每一列都必须归类为「加密」或「明确无敏感内容」，新增列忘了分类会让测试失败", () => {
    const PLAIN: Record<string, string[]> = {
      cases: ["id", "created_at", "updated_at"],
      runs: ["id", "case_id", "at", "ruleset_version"],
      documents: ["id", "case_id", "doc_type", "source_kind", "chars", "needs_ocr", "created_at", "extracted_at", "ocr_confidence"],
      manuals: ["id", "source_kind", "chars", "ocr_confidence", "created_at"],
      check_items: ["id", "kind", "scope", "severity", "source_manual_id", "status", "origin", "created_at", "updated_at"],
      country_rules: ["id", "country_code", "level", "enabled", "reviewed", "created_at", "updated_at"],
      llm_log: ["id", "at", "provider", "model", "case_id", "attempt", "outcome"],
      audit_log: ["id", "at", "action", "case_id", "hash"],
      settings: ["key", "value"],
      meta: ["key", "value"],
      sqlite_sequence: ["name", "seq"],
    };
    const s = new CaseStore(file, { cipher });
    s.close();
    const raw = new DatabaseSync(file, { readOnly: true });
    const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of tables) {
      const cols = (raw.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
      const known = new Set([...((SECRET_COLUMNS as Record<string, readonly string[]>)[t] ?? []), ...(PLAIN[t] ?? [])]);
      for (const c of cols) expect(known.has(c), `未分类的列 ${t}.${c}：请登记到 SECRET_COLUMNS（含敏感内容）或本测试的 PLAIN（元数据）`).toBe(true);
    }
    raw.close();
  });

  it("用同一密钥重新打开，所有数据读回一致，审计链完整", () => {
    const a = new CaseStore(file, { cipher });
    const { c, d, m } = populate(a);
    a.close();
    const b = new CaseStore(file, { cipher: new AesGcmCipher(key) });
    expect(b.encrypted).toBe(true);
    expect(b.listCases()[0]).toMatchObject({ name: MARK.caseName, lcReference: MARK.lcRef });
    expect(b.getCase(c.id)!.presentation!.invoice!.goodsDescription).toBe(MARK.docText);
    expect(b.getDocumentText(d.id).text).toBe(MARK.docText);
    expect(b.listDocuments(c.id)[0]).toMatchObject({ fileName: MARK.docName, extraction: { fields: { currency: { value: "USD" } } } });
    expect(b.getManualText(m.id)).toEqual({ name: "公司审单清单", text: MARK.manualText });
    expect(b.listCheckItems()[0]).toMatchObject({ title: MARK.itemTitle, textMatch: { phrases: ["PHRASE-8855"] }, source: { quote: MARK.quote } });
    expect(b.listLlmLog()[0]!.messages[0]!.content).toBe(MARK.llmSent);
    expect(b.listRuns(c.id)[0]!.findings.length).toBeGreaterThan(0);
    expect(b.listAudit().some((x) => x.action === "case.create")).toBe(true);
    expect(b.verifyAudit()).toBeNull();
    expect(b.verifyIntegrity()).toEqual({ ok: true, problems: [] });
    b.close();
  });

  it("已加密的库：不带密钥打开报 db.keyRequired；密钥不对报 db.wrongKey", () => {
    new CaseStore(file, { cipher }).close();
    expect(() => new CaseStore(file)).toThrowError(expect.objectContaining({ code: "db.keyRequired" }));
    expect(() => new CaseStore(file, { cipher: plainCipher })).toThrowError(expect.objectContaining({ code: "db.keyRequired" }));
    expect(() => new CaseStore(file, { cipher: new AesGcmCipher(generateDataKey()) })).toThrowError(expect.objectContaining({ code: "db.wrongKey" }));
  });
});

describe("从明文库迁移", () => {
  it("整体加密：数据完整、标记从文件中消失（含被替换掉的旧页），重复打开不会重复加密", () => {
    const plain = new CaseStore(file);
    const { c, d } = populate(plain);
    plain.close();
    expect(fileContains(MARK.docText)).toBe(true); // 迁移前确实是明文

    const s = new CaseStore(file, { cipher });
    expect(s.encrypted).toBe(true);
    expect(s.getCase(c.id)!.name).toBe(MARK.caseName);
    expect(s.getDocumentText(d.id).text).toBe(MARK.docText);
    expect(s.verifyIntegrity().ok).toBe(true);
    s.close();
    for (const m of Object.values(MARK)) expect(fileContains(m), m).toBe(false);

    const again = new CaseStore(file, { cipher });
    expect(again.getCase(c.id)!.name).toBe(MARK.caseName);
    again.close();
  });

  it("迁移中途校验失败：整体回滚，数据库保持原样（仍是可读的明文）", () => {
    const plain = new CaseStore(file);
    const { c } = populate(plain);
    plain.close();

    const faulty: Cipher = { enabled: true, seal: (aad, p) => cipher.seal(aad, p), open: () => "不一致" };
    expect(() => new CaseStore(file, { cipher: faulty })).toThrowError(expect.objectContaining({ code: "db.encryptVerifyFailed" }));

    const back = new CaseStore(file); // 不带密钥仍能打开，说明没有留下半加密状态
    expect(back.encrypted).toBe(false);
    expect(back.getCase(c.id)!.name).toBe(MARK.caseName);
    back.close();
  });

  it("空库也能迁移，之后写入的新数据同样是密文", () => {
    new CaseStore(file).close();
    const s = new CaseStore(file, { cipher });
    populate(s);
    s.close();
    expect(fileContains(MARK.caseName)).toBe(false);
  });
});

describe("防篡改", () => {
  it("把一列的密文挪到另一列：读取时报错，而不是悄悄接受", () => {
    const s = new CaseStore(file, { cipher });
    const { c } = populate(s);
    s._unsafeExec("UPDATE cases SET lc_text = name");
    expect(() => s.getCase(c.id)).toThrowError(expect.objectContaining({ code: "db.decryptFailed" }));
    expect(s.verifyIntegrity().ok).toBe(false);
    s.close();
  });

  it("审计记录被改成明文 → 哈希链校验能定位", () => {
    const s = new CaseStore(file, { cipher });
    populate(s);
    expect(s.verifyAudit()).toBeNull();
    s._unsafeExec(`UPDATE audit_log SET detail_json = '{"hacked":true}' WHERE id = 2`);
    expect(s.verifyAudit()).toBe(2);
    expect(s.verifyIntegrity().ok).toBe(false);
    s.close();
  });
});

describe("backupTo（一致性快照）", () => {
  it("快照可用同一密钥打开，内容一致且不含明文；目标已存在则失败", () => {
    const s = new CaseStore(file, { cipher });
    const { c } = populate(s);
    const snap = join(dir, "snap.db");
    s.backupTo(snap);
    expect(() => s.backupTo(snap)).toThrow();
    s.close();

    expect(readFileSync(snap).includes(Buffer.from(MARK.docText))).toBe(false);
    const b = new CaseStore(snap, { cipher: new AesGcmCipher(key) });
    expect(b.getCase(c.id)!.name).toBe(MARK.caseName);
    expect(b.verifyIntegrity().ok).toBe(true);
    b.close();
  });
});

describe("国别规则表的加密", () => {
  const NOTE = "COUNTRY-NOTE-MARK-7741";
  const codes = (s: CaseStore) => s.listCountryRules().map((r) => r.countryCode);
  const rawRules = () => {
    const raw = new DatabaseSync(file, { readOnly: true });
    const rows = raw.prepare("SELECT requirements_json, note FROM country_rules").all() as { requirements_json: string; note: string }[];
    raw.close();
    return rows;
  };
  const rule = { countryCode: "PK", level: "high" as const, requirements: ["carrierBl" as const], note: NOTE, enabled: true, reviewed: true };

  it("含起步清单的明文库带密钥重新打开：requirements_json 与 note 变成密文，数据不变", () => {
    const plain = new CaseStore(file);
    const before = plain.listCountryRules();
    plain.close();
    expect(before.length).toBe(2);
    expect(rawRules().some((r) => r.note.startsWith(SEAL_PREFIX))).toBe(false);

    const s = new CaseStore(file, { cipher });
    expect(s.listCountryRules()).toEqual(before);
    s.close();
    const rows = rawRules();
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.requirements_json.startsWith(SEAL_PREFIX)).toBe(true);
      expect(r.note.startsWith(SEAL_PREFIX)).toBe(true);
    }
  });

  it("加密库关闭后用同一密钥重开：规则保留、不重复写入起步清单；删除后仍保持删除", () => {
    new CaseStore(file, { cipher }).close();
    const a = new CaseStore(file, { cipher });
    expect(codes(a)).toEqual(["BD", "TR"]);
    a.deleteCountryRule(a.listCountryRules()[0]!.id);
    a.close();
    const b = new CaseStore(file, { cipher });
    expect(codes(b)).toEqual(["TR"]);
    b.close();
  });

  it("自定义备注不会以明文出现在主文件或 -wal 中", () => {
    const s = new CaseStore(file, { cipher });
    s.addCountryRule(rule);
    expect(s.listCountryRules().some((r) => r.note === NOTE)).toBe(true);
    expect(fileContains(NOTE)).toBe(false); // 连接未关闭，数据可能还在 -wal 里
    s.close();
    expect(fileContains(NOTE)).toBe(false);
  });

  it("对照：不加密时备注确实出现在文件里", () => {
    const s = new CaseStore(file);
    s.addCountryRule(rule);
    s.close();
    expect(fileContains(NOTE)).toBe(true);
  });
});
