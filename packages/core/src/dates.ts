import type { IsoDate } from "./model";

const toUtc = (d: IsoDate): number => {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
};

export function addDays(d: IsoDate, days: number): IsoDate {
  return new Date(toUtc(d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** a - b，单位：天 */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(a) - toUtc(b)) / 86_400_000);
}

/** ISO 时间 → 本机时区的 "YYYY-MM-DD HH:mm:ss"（库里存的是 UTC，直接截取会与用户的本地时间差若干小时） */
export function formatLocalTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** SWIFT YYMMDD → ISO，非法日期返回 undefined */
export function parseSwiftDate(yymmdd: string): IsoDate | undefined {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(yymmdd);
  if (!m) return undefined;
  const iso = `20${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? undefined : iso;
}
