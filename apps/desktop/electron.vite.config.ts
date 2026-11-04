import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

// 工作区包以 TS 源码形式提供，必须打进产物而不是外部化
const bundled = { exclude: ["@lc/core", "@lc/storage", "@lc/docs", "@lc/services"] };

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin(bundled)] },
  preload: { plugins: [externalizeDepsPlugin(bundled)] },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: { rollupOptions: { input: resolve(__dirname, "src/renderer/index.html") } },
    plugins: [react()],
  },
});
