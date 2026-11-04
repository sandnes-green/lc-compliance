import type { LcApi } from "../../shared/api";

declare global {
  interface Window {
    lc: LcApi;
  }
}
