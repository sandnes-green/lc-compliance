# 信用证合规自查（LC Compliance Check）

面向**出口企业**的 Windows 桌面应用：在把单据交给银行**之前**，先对信用证和拟交单据做一遍合规自查，把可能被银行挑出的不符点提前找出来。

> **定位：** 自查工具，不是银行的审单结论，也不能替代有经验的单证人员。软件没有报问题，不等于银行一定不挑毛病。

## 功能

- **审证**：收到信用证（SWIFT MT700 电文）后，检查信用证本身的隐患——有效期与最迟装运日的关系、疑似软条款、到期地点等。
- **审单**：对发票、运输单据、保险单做检查——币种与金额、交单期、最迟装运、买卖方名称、货物描述、装卸港、保险金额与日期等（依据 UCP 600）。
- **单据导入**：带文字层的 PDF、Word、文本、图片；扫描件与图片走**本地 OCR**（tesseract.js，不上传）。
- **AI 辅助抽取（可选）**：调用 DeepSeek 从单据文字里抽取字段，每个值必须附原文引用，引用对不上的直接丢弃，结果须人工核对后才进入审查。
- **国别规则与船东单核对**：从 MT700 的 52A 读出开证行国家，按可编辑的国别规则表给出审证提示；信用证要求（或国别规则要求）船东单时，核对运输单据是否由承运人签发。
- **审单知识库**：上传公司内部审单清单或客户要求，提炼为自定义检查项（文字检查 / AI 判断 / 人工核对），逐条审核启用后参与审查。
- **报告导出**：PDF 与 Word，含结论、修改清单（按单据分组）、检查清单与免责说明；中英文。
- **内置使用指南**：面向非专业人员，首次启动自动弹出，F1 随时打开。
- **企业级能力**：字段级加密存储、口令加密备份与恢复、自动本地快照、管理员策略、NSIS 安装包、自动更新。

## 设计原则

1. **判定由确定性规则给出。** 合规结论只来自规则引擎；AI 只用于抽取字段和辅助判断，AI 的判断最多是"疑点"，永远不会是"不符点"。
2. **每个结论都能追溯。** 每条发现带规则编号、条款依据和单据原文位置；自定义检查项带手册出处。
3. **缺数据不等于通过。** 缺少所需数据的检查项会明确显示为"未检查"。
4. **数据留在本机。** 只有用户主动启用 AI 并触发相关操作时，相关文字才会发出，发送前默认脱敏，并记入本地外发日志；管理员可用策略完全禁止。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面 | Electron + React + Ant Design，TypeScript |
| 业务核心 | 纯 TypeScript（规则引擎、MT700 解析、LLM 适配），与界面无依赖 |
| 存储 | Node 内置 `node:sqlite` + 字段级 AES-256-GCM 加密，密钥由 Windows DPAPI 保护 |
| 文档处理 | pdfjs-dist（PDF）、tesseract.js + @napi-rs/canvas（OCR）、jszip（Word） |
| 报告 | Electron 打印（PDF）、docx（Word） |
| 打包 / 更新 | electron-builder（NSIS）、electron-updater |
| 测试 | Vitest；Electron 端到端自检（`--smoke`） |

## 目录结构

```
packages/
  core/       领域模型、MT700 解析、规则引擎与内置规则、LLM 适配、抽取校验
  storage/    SQLite 存储、字段级加密、审计哈希链
  docs/       PDF 文字层提取、OCR、Word 提取
  services/   AI 设置、单据导入、知识库、报告、备份恢复、策略、更新状态机
apps/
  desktop/    Electron 主进程、预加载脚本、React 界面、打包配置
docs/
  implementation-plan.md   实施方案与进度
  deployment.md            部署与运维指南（安装、策略、备份恢复、发布更新）
tooling/      生成测试夹具与图标的脚本
```

## 下载与安装

安装包发布在 [GitHub Releases](https://github.com/sandnes-green/lc-compliance/releases/latest)，下载 `LCCompliance-Setup-<版本>.exe` 运行即可（Windows 10/11 x64，按用户安装，不需要管理员权限）。

**安装包目前没有代码签名**，所以首次运行时 Windows SmartScreen 会提示“Windows 已保护你的电脑”：

1. 点击提示里的 **更多信息**；
2. 点击 **仍要运行**。

部分杀毒软件也可能对未签名程序误报。建议下载后核对 SHA256，与 Release 页面公布的值一致再安装：

```powershell
certutil -hashfile LCCompliance-Setup-<版本>.exe SHA256
```

企业 IT 部门可以用同一个校验值登记放行。静默安装、策略配置等见 [`docs/deployment.md`](docs/deployment.md)。

## 快速开始

**环境：** Windows 10/11 x64；Node.js 24（开发与测试所用版本）。

```bash
npm install            # 安装依赖（工作区）
npm run dev            # 开发模式启动
npm test               # 运行全部测试（约 350 个）
npm run typecheck      # 类型检查
npm run smoke          # 构建并运行 Electron 端到端自检
```

### 打包安装程序

```bash
npm run pack           # 只生成免安装目录（快）
npm run dist           # 生成 NSIS 安装包，产物在 apps/desktop/release/
```

首次打包需要下载 Electron 与 NSIS 工具。网络不通时可设置镜像：

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

> 安装包**默认未签名**。代码签名、更新源、企业策略、备份恢复等见 [`docs/deployment.md`](docs/deployment.md)。

## 测试

- 各包的单元测试覆盖规则（通过 / 不符 / 边界）、MT700 解析、加密与篡改检测、备份恢复、策略解析、更新状态机、报告内容与转义等。
- 真实 OCR 引擎也有测试（用生成的位图与"只含图片"的 PDF，不模拟）。
- `npm run smoke` 在真实 Electron 里走完整流程：导入与抽取、OCR、规则、报告导出（并读回 PDF 文字）、知识库、加密（直接读磁盘字节确认无明文）、备份恢复、锁定模式、策略与更新、使用指南。
- **所有测试与夹具使用的都是合成数据，不含任何真实业务数据。**

## 配置与数据

- 数据目录：`%APPDATA%\LCCompliance`（加密数据库、密钥文件、备份）。**切勿把该目录或 `*.lcbak` 备份提交到任何仓库。**
- AI（DeepSeek）的 API Key 在应用「设置」里填写，经系统加密保存在本机，**不写入任何配置文件，也不应出现在仓库里**。
- 企业策略文件：`%ProgramData%\LCCompliance\policy.json`（更新源、是否允许外部 AI），格式见部署文档。

## 当前状态与限制

- 版本 1.1.0。内置规则共 12 条：固定规则 10 条（审证 3、审单 7）加 2 条数据驱动规则（国别风险提示、船东单核对，读取国别规则表），是依据 UCP 600 编写的**保守启发式**，**尚未经过单证专业人员审核**；不含装箱单、原产地证、汇票、正本份数等。
- 国别规则起步清单（BD、TR：船东单）**尚未经过单证专业人员审核**，界面上带“待审核”标记，请审核后再依赖。
- 信用证只能导入 MT700 电文文本，不支持直接导入信用证 PDF。
- 字段级加密防的是"数据库文件被复制走"，元数据（ID、时间、状态等）不加密；不防已登录该 Windows 账户的人。
- 安装包未签名；更新的"重启并安装"步骤与 HTTPS 更新源尚未实测；未在其他 Windows 版本 / 域环境 / 杀毒软件下验证。
- 仅支持 Windows。

## 许可

本项目以 [MIT 许可证](LICENSE) 开源。软件按“现状”提供，不附带任何担保；合规自查结论仅供参考，使用者自行承担依据结论作出决定的责任。
