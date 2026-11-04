// 生成应用图标（512x512 PNG；electron-builder 会据此生成 .ico）
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

const S = 512;
const c = createCanvas(S, S);
const g = c.getContext("2d");

// 圆角深蓝底
const r = 96;
g.fillStyle = "#1456b8";
g.beginPath();
g.moveTo(r, 0); g.arcTo(S, 0, S, S, r); g.arcTo(S, S, 0, S, r); g.arcTo(0, S, 0, 0, r); g.arcTo(0, 0, S, 0, r);
g.closePath();
g.fill();

// 白色文档
g.fillStyle = "#ffffff";
g.beginPath();
g.moveTo(140, 90); g.lineTo(300, 90); g.lineTo(380, 170); g.lineTo(380, 420); g.lineTo(140, 420);
g.closePath();
g.fill();
g.fillStyle = "#c9d8f2";
g.beginPath();
g.moveTo(300, 90); g.lineTo(300, 170); g.lineTo(380, 170);
g.closePath();
g.fill();

// 文字行
g.fillStyle = "#9db7e3";
for (const y of [205, 245, 285]) g.fillRect(175, y, 170, 16);

// 绿色对勾
g.strokeStyle = "#1fa463";
g.lineWidth = 34;
g.lineCap = "round";
g.lineJoin = "round";
g.beginPath();
g.moveTo(190, 355); g.lineTo(235, 395); g.lineTo(330, 305);
g.stroke();

writeFileSync(new URL("../apps/desktop/build/icon.png", import.meta.url), c.toBuffer("image/png"));
