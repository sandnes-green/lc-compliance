import { AppError } from "@lc/core";
import { ocrImage, ocrPdf, prepareLangDir, type OcrProgress } from "@lc/docs";
import type { OcrRunner } from "@lc/services";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { OcrProgressEvent } from "../shared/api";

/** 从 anchorDir 出发按 Node 规则解析包路径（开发时指向应用目录，沿 node_modules 向上查找） */
const resolveFrom = (id: string, from: string) => createRequire(join(from, "noop.js")).resolve(id);

export interface OcrDeps {
  getLangs(): string;
  /** 汇集语言包的目录（位于用户数据目录，首次使用时从安装的语言包复制） */
  langDir: string;
  anchorDir: string;
  emit(e: OcrProgressEvent): void;
}

/** 同一时间只允许一个 OCR 任务（CPU 密集，并行只会互相拖慢）；支持取消 */
export class OcrController {
  private current: AbortController | null = null;

  constructor(private readonly deps: OcrDeps) {}

  cancel(): void {
    this.current?.abort();
  }

  runnerFor(fileName: string): OcrRunner {
    return {
      image: (data) => this.run(fileName, (opts) => ocrImage(data, opts)),
      pdf: (data) => this.run(fileName, (opts) => ocrPdf(data, opts)),
    };
  }

  private async run<T>(fileName: string, job: (opts: { langs: string; langPath: string; signal: AbortSignal; onProgress: (p: OcrProgress) => void }) => Promise<T>): Promise<T> {
    if (this.current) throw new AppError("ocr.busy", "已有文字识别任务在进行，请稍候", {});
    const ac = new AbortController();
    this.current = ac;
    try {
      const langs = this.deps.getLangs();
      const langPath = prepareLangDir(this.deps.langDir, langs, this.deps.anchorDir, resolveFrom);
      return await job({ langs, langPath, signal: ac.signal, onProgress: (p) => this.deps.emit({ fileName, ...p }) });
    } finally {
      this.current = null;
    }
  }
}
