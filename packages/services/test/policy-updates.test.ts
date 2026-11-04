import { describe, expect, it, vi } from "vitest";
import type { LlmClient } from "@lc/core";
import { CaseStore } from "@lc/storage";
import { AiService, DEFAULT_POLICY, UpdateService, isAllowedFeedUrl, parsePolicy, type Policy, type SecretBox, type UpdaterDriver } from "../src";

describe("isAllowedFeedUrl", () => {
  it("只接受 HTTPS；http 仅在允许本机时可用于 localhost", () => {
    expect(isAllowedFeedUrl("https://updates.corp.example/lc/")).toBe(true);
    expect(isAllowedFeedUrl("http://updates.corp.example/lc/")).toBe(false);
    expect(isAllowedFeedUrl("http://localhost:8080/lc/")).toBe(false);
    expect(isAllowedFeedUrl("http://localhost:8080/lc/", { allowLocalHttp: true })).toBe(true);
    expect(isAllowedFeedUrl("http://127.0.0.1:9/x", { allowLocalHttp: true })).toBe(true);
    expect(isAllowedFeedUrl("http://evil.example/x", { allowLocalHttp: true })).toBe(false);
  });
  it("拒绝带凭据的、非 http(s) 的、无法解析的地址", () => {
    expect(isAllowedFeedUrl("https://user:pw@updates.example/")).toBe(false);
    expect(isAllowedFeedUrl("file:///c:/x")).toBe(false);
    expect(isAllowedFeedUrl("ftp://x/y")).toBe(false);
    expect(isAllowedFeedUrl("not a url")).toBe(false);
    expect(isAllowedFeedUrl("")).toBe(false);
  });
});

describe("parsePolicy", () => {
  it("没有策略文件：全部默认", () => {
    expect(parsePolicy(null)).toEqual({ policy: DEFAULT_POLICY, warnings: [] });
  });

  it("解析合法策略（含 BOM）", () => {
    const text = "﻿" + JSON.stringify({ update: { enabled: true, feedUrl: "https://u.example/lc/", autoCheck: false }, ai: { allowed: false } });
    const { policy, warnings } = parsePolicy(text);
    expect(warnings).toEqual([]);
    expect(policy).toEqual({ update: { enabled: true, feedUrl: "https://u.example/lc/", autoCheck: false }, ai: { allowed: false } });
  });

  it("写错了只忽略那一项（回到默认）并给警告，不会让应用起不来", () => {
    const r = parsePolicy(JSON.stringify({ update: { enabled: "yes", feedUrl: "http://insecure.example/", autoCheck: false }, ai: "no" }));
    expect(r.policy.update).toEqual({ enabled: true, feedUrl: null, autoCheck: false });
    expect(r.policy.ai.allowed).toBe(true);
    expect(r.warnings.map((w) => w.field).sort()).toEqual(["ai", "update.enabled", "update.feedUrl"]);
  });

  it("不是 JSON / 不是对象：全部默认并警告", () => {
    for (const bad of ["{oops", "[1,2]", "42", "null", ""]) {
      const r = parsePolicy(bad);
      expect(r.policy).toEqual(DEFAULT_POLICY);
      expect(r.warnings).toEqual([{ code: "invalidJson" }]);
    }
  });

  it("未知字段被忽略；返回的是新对象，不会污染默认值", () => {
    const r = parsePolicy(JSON.stringify({ foo: 1, update: { bar: 2 } }));
    expect(r.warnings).toEqual([]);
    r.policy.update.enabled = false;
    expect(DEFAULT_POLICY.update.enabled).toBe(true);
  });
});

function fakeDriver(over: Partial<UpdaterDriver> = {}) {
  const calls: string[] = [];
  const driver: UpdaterDriver = {
    configure: (url) => void calls.push(`configure:${url}`),
    check: async () => (calls.push("check"), { version: "2.0.0" }),
    download: async (onProgress) => {
      calls.push("download");
      onProgress(30.4);
      onProgress(100);
    },
    quitAndInstall: () => void calls.push("install"),
    ...over,
  };
  return { driver, calls };
}

const policy = (over: Partial<Policy["update"]> = {}): Policy => ({ ...DEFAULT_POLICY, update: { enabled: true, feedUrl: "https://u.example/lc/", autoCheck: true, ...over } });

describe("UpdateService", () => {
  const make = (p: Policy, o: { isPackaged?: boolean; driver?: UpdaterDriver } = {}) => {
    const f = fakeDriver();
    const svc = new UpdateService({ driver: o.driver ?? f.driver, policy: () => p, currentVersion: "1.0.0", isPackaged: o.isPackaged ?? true, now: () => new Date("2026-01-01T00:00:00Z") });
    return { svc, calls: f.calls };
  };

  it("开发版（未打包）、策略禁用、没有更新源：都是 disabled 并说明原因，不会联网", async () => {
    const dev = make(policy(), { isPackaged: false });
    expect(dev.svc.getState()).toMatchObject({ status: "disabled", disabledReason: "devBuild" });
    expect((await dev.svc.check()).status).toBe("disabled");
    expect(make(policy({ enabled: false })).svc.getState().disabledReason).toBe("policy");
    expect(make(policy({ feedUrl: null })).svc.getState().disabledReason).toBe("noFeed");
    expect(dev.calls).toEqual([]);
  });

  it("检查 → 有新版本 → 用户确认下载 → 下载完成 → 用户确认安装；每一步按顺序且可订阅", async () => {
    const { svc, calls } = make(policy());
    const seen: string[] = [];
    svc.subscribe((s) => seen.push(s.status));

    expect((await svc.check()).status).toBe("available");
    expect(svc.getState()).toMatchObject({ availableVersion: "2.0.0", lastCheckedAt: "2026-01-01T00:00:00.000Z" });
    expect(svc.install()).toBe(false); // 还没下载，不能安装
    expect((await svc.download()).status).toBe("downloaded");
    expect(svc.getState().percent).toBe(100);
    expect(svc.install()).toBe(true);
    expect(calls).toEqual(["configure:https://u.example/lc/", "check", "download", "install"]);
    expect(seen).toEqual(["checking", "available", "downloading", "downloading", "downloading", "downloaded"]);
  });

  it("没有新版本 → none；之后可以再检查", async () => {
    const f = fakeDriver({ check: async () => null });
    const svc = new UpdateService({ driver: f.driver, policy: () => policy(), currentVersion: "1.0.0", isPackaged: true });
    expect((await svc.check()).status).toBe("none");
    expect((await svc.download()).status).toBe("none"); // 没有可下载的
    expect((await svc.check()).status).toBe("none");
  });

  it("检查失败进入 error（附原因），不抛出；下次可重试", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("网络不通")).mockResolvedValueOnce({ version: "2.0.0" });
    const f = fakeDriver({ check });
    const svc = new UpdateService({ driver: f.driver, policy: () => policy(), currentVersion: "1.0.0", isPackaged: true });
    expect(await svc.check()).toMatchObject({ status: "error", error: "网络不通" });
    expect((await svc.check()).status).toBe("available");
  });

  it("下载失败回到「有新版本」可重试；进度被限制在 0..100", async () => {
    let n = 0;
    const f = fakeDriver({
      download: async (cb) => {
        cb(-5);
        cb(250);
        if (n++ === 0) throw new Error("下载中断");
      },
    });
    const svc = new UpdateService({ driver: f.driver, policy: () => policy(), currentVersion: "1.0.0", isPackaged: true });
    await svc.check();
    const failed = await svc.download();
    expect(failed).toMatchObject({ status: "available", error: "下载中断", percent: 0 });
    expect((await svc.download()).status).toBe("downloaded");
  });

  it("检查进行中再次检查不会重复请求", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const check = vi.fn(async () => {
      await gate;
      return null;
    });
    const svc = new UpdateService({ driver: fakeDriver({ check }).driver, policy: () => policy(), currentVersion: "1.0.0", isPackaged: true });
    const first = svc.check();
    const second = await svc.check();
    expect(second.status).toBe("checking");
    release();
    await first;
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("运行中策略被管理员改成禁用：立即生效；autoCheck 只在可用且策略允许时为真", async () => {
    let p = policy();
    const svc = new UpdateService({ driver: fakeDriver().driver, policy: () => p, currentVersion: "1.0.0", isPackaged: true });
    expect(svc.autoCheck).toBe(true);
    await svc.check();
    p = policy({ enabled: false });
    expect(svc.getState()).toMatchObject({ status: "disabled", disabledReason: "policy" });
    expect(svc.autoCheck).toBe(false);
    p = policy({ autoCheck: false });
    expect(svc.getState().status).toBe("idle");
    expect(svc.autoCheck).toBe(false);
  });

  it("已下载后不会被再次检查覆盖（避免丢掉待安装的更新）", async () => {
    const { svc, calls } = make(policy());
    await svc.check();
    await svc.download();
    await svc.check();
    expect(svc.getState().status).toBe("downloaded");
    expect(calls.filter((c) => c === "check")).toHaveLength(1);
  });
});

describe("AI 策略锁定", () => {
  const box: SecretBox = { encrypt: (p) => `e:${p}`, decrypt: (e) => e.slice(2) };
  function setup(allowed: { v: boolean }) {
    const store = new CaseStore();
    let calls = 0;
    const client: LlmClient = { completeJson: async () => (calls++, {}), listModels: async () => ["m"] };
    const ai = new AiService(store, box, () => client, () => allowed.v);
    return { store, ai, calls: () => calls };
  }

  it("策略禁止：无法启用；设置里显示被策略锁定；任何联网功能都拒绝", async () => {
    const allowed = { v: false };
    const { ai, calls } = setup(allowed);
    expect(ai.getSettings()).toMatchObject({ enabled: false, blockedByPolicy: true });
    expect(() => ai.save({ enabled: true, consent: true, apiKey: "k" })).toThrowError(expect.objectContaining({ code: "ai.blockedByPolicy" }));
    await expect(ai.listModels()).rejects.toMatchObject({ code: "ai.blockedByPolicy" });
    await expect(ai.test()).rejects.toMatchObject({ code: "ai.blockedByPolicy" });
    expect(() => ai.llm(null)).toThrowError(expect.objectContaining({ code: "ai.blockedByPolicy" }));
    expect(calls()).toBe(0);
  });

  it("之前已启用，后来策略改为禁止：立即视为未启用且不再外发；解除禁止后恢复", async () => {
    const allowed = { v: true };
    const { ai, calls } = setup(allowed);
    ai.save({ enabled: true, consent: true, apiKey: "k" });
    await ai.test();
    expect(calls()).toBe(1);

    allowed.v = false;
    expect(ai.getSettings()).toMatchObject({ enabled: false, blockedByPolicy: true });
    await expect(ai.test()).rejects.toMatchObject({ code: "ai.blockedByPolicy" });
    expect(calls()).toBe(1);

    allowed.v = true;
    expect(ai.getSettings().enabled).toBe(true);
    await ai.test();
    expect(calls()).toBe(2);
  });

  it("策略允许时行为不变（默认参数）", () => {
    const { ai } = setup({ v: true });
    expect(ai.getSettings().blockedByPolicy).toBe(false);
    expect(() => ai.save({ enabled: true })).toThrowError(expect.objectContaining({ code: "ai.consentRequired" }));
  });
});
