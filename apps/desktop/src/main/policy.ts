import { parsePolicy, type Policy, type PolicyWarning } from "@lc/services";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface PolicySnapshot {
  file: string;
  found: boolean;
  policy: Policy;
  warnings: PolicyWarning[];
}

/** 策略文件位置：%ProgramData%\LCCompliance\policy.json（机器级，通常只有管理员可写）。仅开发/自检时允许用环境变量覆盖 */
export function policyFilePath(allowOverride: boolean): string {
  const override = allowOverride ? process.env.LC_POLICY_FILE : undefined;
  return override ?? join(process.env.ProgramData ?? "C:\\ProgramData", "LCCompliance", "policy.json");
}

/**
 * 策略读取器：按文件修改时间缓存，管理员改了文件后下次读取即生效，无需重启。
 * 文件读不了（权限、被占用）时按「没有策略」处理并给出警告，而不是让应用无法使用。
 */
export function createPolicyReader(opts: { allowOverride: boolean; allowLocalHttp: boolean }) {
  let cacheKey = "";
  let cached: PolicySnapshot | null = null;

  return function read(): PolicySnapshot {
    const file = policyFilePath(opts.allowOverride);
    let key = "absent";
    try {
      if (existsSync(file)) {
        const st = statSync(file);
        key = `${st.mtimeMs}:${st.size}`;
      }
    } catch {
      key = "unreadable";
    }
    const full = `${file}|${key}`;
    if (cached && full === cacheKey) return cached;

    let text: string | null = null;
    let warnings: PolicyWarning[] = [];
    if (key !== "absent") {
      try {
        text = readFileSync(file, "utf8");
      } catch {
        warnings = [{ code: "invalidJson" }];
      }
    }
    const parsed = parsePolicy(text, { allowLocalHttp: opts.allowLocalHttp });
    cacheKey = full;
    cached = { file, found: key !== "absent", policy: parsed.policy, warnings: [...warnings, ...parsed.warnings] };
    return cached;
  };
}
