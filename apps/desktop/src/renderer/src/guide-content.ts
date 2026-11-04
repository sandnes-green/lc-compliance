import type { Language } from "../../shared/api";

/**
 * 使用指南内容（面向非专业人员）。
 * 文字里的 {{key}} 在显示时替换为界面上真实的文案（取自 i18n 字典），因此指南里提到的按钮、页签名称永远与界面一致；
 * **文字** 表示加粗。测试会检查所有 {{key}} 都存在、中英文结构一致。
 */
export type Block =
  | { type: "p"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "list"; items: string[] }
  | { type: "tip" | "warn" | "note"; text: string }
  | { type: "severity"; items: { sev: "discrepancy" | "risk" | "doubt" | "info"; desc: string }[] }
  | { type: "terms"; items: { term: string; desc: string }[] }
  | { type: "faq"; items: { q: string; a: string }[] };

export interface Section {
  id: string;
  title: string;
  blocks: Block[];
}

const zh: Section[] = [
  {
    id: "about",
    title: "这个软件是做什么的",
    blocks: [
      { type: "p", text: "出口交单前，银行会逐项检查你们提交的单据，只要发现和信用证要求**有一处对不上**，就有权拒绝付款。这个软件帮你**在交给银行之前先检查一遍**，把问题提前找出来，让你有时间改。" },
      { type: "p", text: "它会做两件事：" },
      { type: "list", items: ["**审证**：收到信用证后，检查信用证本身有没有对你们不利或做不到的条款（比如有效期太短、有「软条款」）。", "**审单**：单据做好后，检查发票、提单、保险单有没有和信用证对不上的地方。"] },
      { type: "warn", text: "这是**自查工具**，不是银行的审核结果，也不能代替有经验的单证员。软件没有报问题，不等于银行一定不挑毛病。重要的单子，请让有经验的同事再看一遍。" },
    ],
  },
  {
    id: "quickstart",
    title: "5 分钟快速上手",
    blocks: [
      {
        type: "steps",
        items: [
          "点左上角「{{btn.newCase}}」，把银行发来的**信用证电文**粘贴进去（或点「{{btn.chooseFile}}」选文件），再点「{{btn.create}}」。",
          "软件会自动做**审证**，直接带你到「{{tab.result}}」。先看有没有红色、橙色的提示。",
          "货备好、单据做好之后，打开「{{tab.docs}}」，导入发票、提单、保险单的文件（也可以直接手工填）。",
          "确认填的内容没错，点「{{btn.saveRun}}」。",
          "回到「{{tab.result}}」，看哪里对不上，照每条提示里的**建议**去改单据。改完再审查一次，直到满意。",
          "点「{{report.exportPdf}}」或「{{report.exportWord}}」，把结果存档，或发给同事、客户。",
        ],
      },
      { type: "tip", text: "没有任何单据时也可以先用：只导入信用证，就能得到审证结果。" },
    ],
  },
  {
    id: "step-case",
    title: "第一步：新建案件（导入信用证）",
    blocks: [
      { type: "p", text: "一个「案件」对应一份信用证。每做一笔业务，新建一个案件。" },
      {
        type: "steps",
        items: [
          "点「{{btn.newCase}}」。",
          "在「{{modal.name}}」里起一个好认的名字，比如「客户A-8月出口」。",
          "把信用证电文粘贴到大文本框里，或点「{{btn.chooseFile}}」选择文本文件。",
          "点「{{btn.create}}」。",
        ],
      },
      { type: "note", text: "**信用证电文是什么？** 开证银行发给你们的信用证，通常是一段以 :20:、:32B: 这类编号开头的文本（SWIFT MT700 格式）。请向你们的银行或公司单证员要「电文文本」。" },
      { type: "warn", text: "目前只能导入这种电文文本，**不能直接导入信用证的 PDF 或纸质件**。如果只有 PDF，请让银行提供电文文本。" },
      { type: "p", text: "创建成功后，在「{{tab.lc}}」页可以看到软件读出来的金额、有效期、最迟装运日等。请**对照原件核对一遍**这些信息是否读对了。" },
    ],
  },
  {
    id: "step-lc-review",
    title: "第二步：看审证结果",
    blocks: [
      { type: "p", text: "新建案件后，软件会马上检查信用证本身，结果在「{{tab.result}}」的「{{result.section.lc}}」部分。每条提示有四种级别：" },
      {
        type: "severity",
        items: [
          { sev: "discrepancy", desc: "确定的问题。如果是单据上的不符点，银行有权拒付，必须处理。" },
          { sev: "risk", desc: "信用证条款本身有隐患，比如有效期留给你的时间太短，或者出现「软条款」（意思见最后的名词小词典，软件会标成「疑似软条款」）。建议**发货前**和客户沟通，要求修改信用证。" },
          { sev: "doubt", desc: "软件拿不准的地方，需要你自己或同事人工看一下。" },
          { sev: "info", desc: "仅供参考，不一定要处理。" },
        ],
      },
      { type: "p", text: "每条提示都会写明**依据**（比如依据哪条规则）、**哪里有问题**和**建议怎么办**。" },
      { type: "tip", text: "审证越早做越好：发现信用证有问题，在货发出去**之前**让客户改，比货发走后再补救容易得多。" },
    ],
  },
  {
    id: "step-docs",
    title: "第三步：导入单据",
    blocks: [
      { type: "p", text: "打开「{{tab.docs}}」页。上半部分是「{{docfiles.title}}」，下半部分是需要填的表格。" },
      { type: "p", text: "**方法一（推荐）：导入文件，让软件帮你填**" },
      {
        type: "steps",
        items: [
          "点「{{btn.importInvoice}}」、「{{btn.importTransport}}」或「{{btn.importInsurance}}」，选择对应的文件。支持 PDF、Word、文本文件和图片（拍照或扫描都行）。",
          "如果是**扫描件或图片**，软件会自动识别文字，需要等几秒，期间可以点「{{ocr.cancel}}」。识别结果有一个百分比，越低越不可靠。",
          "点「{{btn.extract}}」，软件会把金额、日期、名称等填到下面的表格里，并在旁边写明是从原文哪一句读出来的。",
        ],
      },
      { type: "warn", text: "**软件读出来的内容可能有错**，特别是数字（比如 0 和 O、1 和 l 容易混）。每次都请对照原单据核对表格，再继续。" },
      { type: "p", text: "识别不准？点「{{btn.viewText}}」，可以直接修改识别出来的文字，改好后重新点「{{btn.extract}}」。" },
      { type: "p", text: "**方法二：手工填写**" },
      { type: "p", text: "不想用 AI，或者没有电子文件，直接在表格里填就行。需要填的内容：" },
      {
        type: "list",
        items: [
          "「{{docs.presentationDate}}」：你打算哪天把单据交给银行。",
          "「{{docs.sectionInvoice}}」：卖方名称、买方名称、货物描述、币种和金额。",
          "「{{docs.sectionTransport}}」：装运日期（提单上「已装船」的日期）、装运港、卸货港。",
          "「{{docs.sectionInsurance}}」：投保币种、金额和保险单日期。",
        ],
      },
      { type: "tip", text: "没有的单据可以留空。留空的项目对应的检查会显示为「未检查」，而不是「通过」。" },
      { type: "p", text: "填好后，点「{{btn.saveRun}}」。" },
    ],
  },
  {
    id: "step-result",
    title: "第四步：看懂审查结果",
    blocks: [
      { type: "p", text: "点「{{btn.saveRun}}」后会自动跳到「{{tab.result}}」。从上到下依次是：" },
      {
        type: "list",
        items: [
          "**顶部**：不符点、风险、疑点各有几条。",
          "「{{result.section.lc}}」：信用证本身的问题。",
          "「{{result.section.docs}}」：单据的问题。每条会列出**对比的两边**（比如信用证写的和发票写的），以及建议怎么改。想要按单据分好组的修改清单，请导出报告（见第五步）。",
          "**检查清单**：每一项检查是「已检查」还是「未检查」。",
        ],
      },
      { type: "warn", text: "**「{{result.coverage.skipped}}」不等于没问题。** 它说明你没填那部分数据，软件根本没检查。补充数据后再点「{{btn.saveRun}}」。" },
      { type: "p", text: "改完单据后，回到「{{tab.docs}}」更新内容，再点一次「{{btn.saveRun}}」，反复到满意为止。" },
      { type: "warn", text: "**没有发现不符点，也不代表单据完全没问题。** 软件目前只检查发票、运输单据、保险单和信用证本身。装箱单、原产地证、汇票、正本份数等**还没有检查**，请自己再核对。" },
    ],
  },
  {
    id: "step-report",
    title: "第五步：导出报告",
    blocks: [
      { type: "p", text: "在「{{tab.result}}」页上方点「{{report.exportPdf}}」或「{{report.exportWord}}」。" },
      {
        type: "list",
        items: ["**PDF**：适合存档或发给别人看，不能改。", "**Word**：可以继续编辑，比如加上你们公司的抬头。"],
      },
      { type: "p", text: "报告里有：结论、信用证主要内容、审查用的数据、每个问题的说明、**按单据分好组的修改清单**（可以打印出来逐项打勾）、检查清单和免责说明。报告用当前界面的语言生成。" },
    ],
  },
  {
    id: "advanced",
    title: "进阶功能（可以先不看）",
    blocks: [
      { type: "p", text: "**审单知识库**：如果你们公司有自己的审单清单，或客户有特殊要求（比如「提单必须注明运费预付」），可以上传到软件里，变成每次审查都会检查的项目。" },
      {
        type: "steps",
        items: [
          "点左侧「{{btn.knowledge}}」，再点「{{kb.upload}}」，选择你们的清单文件（PDF、Word、文本、图片都可以）。",
          "点「{{kb.extract}}」，软件会把清单拆成一条条检查项。",
          "到「{{kb.tabItems}}」页，**逐条看**拆得对不对，没问题的点「{{kb.enable}}」。**没有启用的不会参与审查**。",
        ],
      },
      { type: "p", text: "检查项有三种：**文字检查**（在单据里找指定的词，结果确定）、**AI 判断**（让 AI 看是否满足要求，只会给出「疑点」，需要你确认）、**人工核对**（软件查不了，只提醒你自己去做）。" },
      { type: "p", text: "**AI 功能**：「{{btn.extract}}」和上面的提炼检查项都要用到 AI（DeepSeek）。需要先到「{{btn.settings}}」→「{{settings.tabAi}}」，打开「{{settings.enable}}」开关并填入 API Key（向公司 IT 获取，或自己在 DeepSeek 开放平台申请）。含「AI 判断」的检查项，每次审查也会调用 AI，需要多等一会儿，也会产生费用。如果公司不允许把单据内容发到外部，请不要启用，手工填写即可；也可能是管理员已经统一关闭了这个功能。" },
    ],
  },
  {
    id: "safety",
    title: "数据安全与备份（请务必看）",
    blocks: [
      { type: "p", text: "你的案件、单据内容、审查结果都**加密保存在本机**，别人拷走数据库文件也读不出来。" },
      { type: "warn", text: "加密的密钥和你的 **Windows 账户**绑定。**换电脑、重装系统、换 Windows 用户后，如果没有备份，数据无法找回。**" },
      {
        type: "steps",
        items: [
          "打开「{{btn.settings}}」→「{{settings.tabData}}」，点「{{sec.exportBackup}}」。",
          "设置一个备份口令（至少 8 位），**记在安全的地方**。口令忘了，备份就打不开。",
          "选择保存位置（建议放在公司网盘或移动硬盘，不要和电脑放在同一个地方）。",
        ],
      },
      { type: "tip", text: "建议**每个月备份一次**。超过 30 天没备份，「{{settings.tabData}}」页会用黄色提示提醒你。需要恢复时点「{{sec.restore}}」，输入口令选备份文件即可，换新电脑也一样。" },
      { type: "p", text: "如果打开软件时看到「无法解锁数据」，说明密钥读不出来。请不要慌：软件没有改动任何数据，点「{{sec.restore}}」用备份恢复，或联系公司 IT。" },
    ],
  },
  {
    id: "faq",
    title: "常见问题",
    blocks: [
      {
        type: "faq",
        items: [
          { q: "点「{{btn.create}}」后提示信用证缺少字段", a: "说明电文不完整。电文里至少要有 :20:（信用证编号）和 :32B:（币种和金额）两行。请向银行要**完整的电文**，不要只复制一部分。" },
          { q: "结果里出现「{{result.coverage.skipped}}」是什么意思？", a: "你没有填写那项检查需要的数据（比如没填保险单），软件没法检查。补上数据后再点「{{btn.saveRun}}」。如果你们这笔业务本来就没有这种单据，可以忽略。" },
          { q: "软件没有报不符点，可以放心交单了吗？", a: "不可以完全放心。软件只检查它覆盖的项目（见「第四步」最后的提醒），而且银行有自己的判断。把软件当成**帮你多一双眼睛**，不要当成最终结论。" },
          { q: "AI 填的内容和单据对不上怎么办？", a: "AI 会出错。请以**原单据**为准，直接在表格里改正确。不放心的话，可以不用 AI，全部手工填写。" },
          { q: "扫描件识别得不准，很多错字", a: "三个办法：① 点「{{btn.viewText}}」手工改正；② 换一份更清晰的扫描件（正放、不要歪斜、不要有阴影）；③ 到「{{btn.settings}}」→「{{settings.tabOcr}}」，如果单据里有中文，把识别语言改成「英文 + 简体中文」。" },
          { q: "单据内容会被发到网上吗？", a: "**只有你启用了 AI 功能**，并且点了「{{btn.extract}}」或提炼检查项时，相关文字才会发给 AI 服务（DeepSeek）。发送前默认会遮蔽银行账号、邮箱、电话。每次发了什么，都能在「{{btn.settings}}」→「外发数据日志」里查到。不启用 AI，什么都不会发出去。扫描件的文字识别始终在你自己的电脑上完成。" },
          { q: "这份报告可以直接给银行看吗？", a: "不建议。它是你们**内部自查**用的，更适合发给同事、单证员或客户，用来沟通哪里需要修改。" },
          { q: "怎么删除一个案件？", a: "在左侧案件列表里，点那一行右边的垃圾桶图标。会同时删除这个案件的单据和审查记录，**不能撤销**。" },
          { q: "怎么切换中文和英文？", a: "点左侧的「中文 / English」，或使用顶部菜单的「语言」。报告也会按当前语言生成。" },
          { q: "怎么更新软件？", a: "到「{{btn.settings}}」→「{{settings.tabUpdate}}」点「检查更新」。更新需要你确认才会下载和安装，不会突然重启。如果显示「管理员尚未配置更新源」，说明公司统一管理更新，请联系 IT。" },
        ],
      },
      { type: "p", text: "还是解决不了？请联系你们公司的 IT 或单证主管，并告诉他们软件版本号（在「{{btn.settings}}」→「{{settings.tabUpdate}}」里能看到）。" },
    ],
  },
  {
    id: "terms",
    title: "名词小词典",
    blocks: [
      {
        type: "terms",
        items: [
          { term: "信用证（L/C）", desc: "银行应进口商（你们的客户）的要求开出的付款承诺：只要你们提交的单据**严格符合**信用证的要求，银行就付款。" },
          { term: "受益人", desc: "收款的一方，通常就是你们公司（出口商）。" },
          { term: "申请人", desc: "申请开立信用证的一方，通常是你们的客户（进口商）。" },
          { term: "交单", desc: "把发票、提单、保险单等单据交给银行，请银行付款的动作。" },
          { term: "不符点", desc: "单据和信用证要求不一致的地方。银行只要发现一处，就有权拒绝付款。" },
          { term: "单证相符", desc: "单据和信用证一致，单据和单据之间也互相一致。" },
          { term: "有效期", desc: "信用证最晚可以交单的日期，过了就作废。注意还要看「到期地点」，意思是单据要在这个日期前**送到那个城市的银行**。" },
          { term: "最迟装运日", desc: "货物最晚必须装船（或发运）的日期。" },
          { term: "交单期", desc: "货装船之后，多少天内必须把单据交给银行。信用证没写的话，默认是 21 天。" },
          { term: "提单（B/L）", desc: "船公司开出的货物收据，也是提货凭证。" },
          { term: "商业发票", desc: "卖方开给买方的货款清单，写明货物、数量、单价、总金额。" },
          { term: "保险单", desc: "货物运输保险的凭证。信用证要求你们买保险时才需要。" },
          { term: "软条款", desc: "能不能满足取决于客户（而不是你们自己）的条款，比如「检验证书必须由买方签字」。这类条款可能让信用证形同虚设，要尽早要求修改。" },
          { term: "UCP 600", desc: "国际商会制定的信用证统一规则，全球银行审单的主要依据。软件的检查大多依据它。" },
          { term: "MT700", desc: "银行之间开立信用证所用的电文格式。导入信用证时需要的就是这种文本。" },
          { term: "审证 / 审单", desc: "审证：检查信用证本身。审单：检查你们要交的单据。" },
          { term: "OCR（文字识别）", desc: "把扫描件、图片里的文字读出来的技术。在你自己的电脑上完成，不会上传。" },
          { term: "脱敏", desc: "发给 AI 之前，把银行账号、邮箱、电话等敏感信息遮蔽掉。" },
        ],
      },
    ],
  },
];

const en: Section[] = [
  {
    id: "about",
    title: "What this software does",
    blocks: [
      { type: "p", text: "Before you present export documents, the bank examines them line by line, and if **even one thing** does not match the letter of credit it is entitled to refuse payment. This software lets you **check the documents yourself first**, so you can find problems early and have time to fix them." },
      { type: "p", text: "It does two things:" },
      { type: "list", items: ["**L/C review**: after you receive the credit, it checks the credit itself for terms that work against you or that you cannot meet (for example a validity that is too short, or a “soft clause”).", "**Document check**: once your documents are ready, it checks the invoice, transport document and insurance document for anything that does not match the credit."] },
      { type: "warn", text: "This is a **self-check tool**, not the bank's examination, and it does not replace an experienced documentary-credit specialist. If the software reports nothing, the bank may still find something. For important shipments, have an experienced colleague look it over." },
    ],
  },
  {
    id: "quickstart",
    title: "Quick start (5 minutes)",
    blocks: [
      {
        type: "steps",
        items: [
          "Click “{{btn.newCase}}” at the top left, paste in the **L/C message** your bank sent (or click “{{btn.chooseFile}}”), then click “{{btn.create}}”.",
          "The software does the **L/C review** automatically and takes you to “{{tab.result}}”. Look first for red or orange items.",
          "When the goods are ready and the documents made, open “{{tab.docs}}” and import the invoice, transport document and insurance document (or fill the form by hand).",
          "Check that what is filled in is right, then click “{{btn.saveRun}}”.",
          "Back on “{{tab.result}}”, see what does not match and correct the documents following the **suggestion** in each item. Check again after editing, until you are satisfied.",
          "Click “{{report.exportPdf}}” or “{{report.exportWord}}” to keep a record or send it to a colleague or customer.",
        ],
      },
      { type: "tip", text: "You can use it without any documents: import just the credit and you get the L/C review." },
    ],
  },
  {
    id: "step-case",
    title: "Step 1: Create a case (import the L/C)",
    blocks: [
      { type: "p", text: "One “case” corresponds to one letter of credit. Create a new case for each deal." },
      {
        type: "steps",
        items: [
          "Click “{{btn.newCase}}”.",
          "Give it an easy-to-recognise name in “{{modal.name}}”, such as “Customer A – August export”.",
          "Paste the L/C message into the large box, or click “{{btn.chooseFile}}” to pick a text file.",
          "Click “{{btn.create}}”.",
        ],
      },
      { type: "note", text: "**What is an L/C message?** The credit your issuing bank sends is usually a block of text whose lines start with tags such as :20: and :32B: (SWIFT MT700 format). Ask your bank or your documentation clerk for the “message text”." },
      { type: "warn", text: "At the moment you can only import this message text; **a PDF or paper copy of the credit cannot be imported directly**. If you only have a PDF, ask the bank for the message text." },
      { type: "p", text: "After it is created, the “{{tab.lc}}” tab shows the amount, expiry, latest shipment date and so on that the software read. **Compare them with the original** to be sure they were read correctly." },
    ],
  },
  {
    id: "step-lc-review",
    title: "Step 2: Read the L/C review",
    blocks: [
      { type: "p", text: "Right after you create a case the software checks the credit itself. The results are on “{{tab.result}}” under “{{result.section.lc}}”. Each item has one of four levels:" },
      {
        type: "severity",
        items: [
          { sev: "discrepancy", desc: "A definite problem. If it is a discrepancy in your documents the bank may refuse payment, so it must be dealt with." },
          { sev: "risk", desc: "A term of the credit itself is a hazard, for example it leaves you too little time, or it contains a “soft clause” (explained in the glossary at the end; the software marks it as “Possible soft clause”). Talk to your customer **before shipping** and ask for an amendment." },
          { sev: "doubt", desc: "Something the software cannot decide; you or a colleague need to look at it." },
          { sev: "info", desc: "For your information; not necessarily something to act on." },
        ],
      },
      { type: "p", text: "Each item states its **basis** (which rule), **what is wrong** and **what to do**." },
      { type: "tip", text: "The earlier you do the L/C review the better: getting the customer to amend the credit **before** the goods ship is far easier than fixing things afterwards." },
    ],
  },
  {
    id: "step-docs",
    title: "Step 3: Import your documents",
    blocks: [
      { type: "p", text: "Open the “{{tab.docs}}” tab. The upper part is “{{docfiles.title}}” and the lower part is the form to fill in." },
      { type: "p", text: "**Method 1 (recommended): import files and let the software fill in the form**" },
      {
        type: "steps",
        items: [
          "Click “{{btn.importInvoice}}”, “{{btn.importTransport}}” or “{{btn.importInsurance}}” and choose the file. PDF, Word, text files and images (photos or scans) are supported.",
          "For a **scan or image** the software reads the text automatically. It takes a few seconds and you can click “{{ocr.cancel}}”. The result shows a percentage; the lower it is, the less reliable the text.",
          "Click “{{btn.extract}}”. The software fills the amount, dates, names and so on into the form below, and shows which sentence of the original each one came from.",
        ],
      },
      { type: "warn", text: "**What the software reads may be wrong**, especially numbers (0 and O, 1 and l are easily confused). Every time, compare the form with the original document before you carry on." },
      { type: "p", text: "Not reading well? Click “{{btn.viewText}}” to edit the recognised text directly, then click “{{btn.extract}}” again." },
      { type: "p", text: "**Method 2: fill in by hand**" },
      { type: "p", text: "If you do not want to use AI, or have no electronic file, just type into the form. What to fill in:" },
      {
        type: "list",
        items: [
          "“{{docs.presentationDate}}”: the day you plan to hand the documents to the bank.",
          "“{{docs.sectionInvoice}}”: seller name, buyer name, goods description, currency and amount.",
          "“{{docs.sectionTransport}}”: shipment date (the “shipped on board” date on the B/L), port of loading, port of discharge.",
          "“{{docs.sectionInsurance}}”: insured currency, amount and the date of the insurance document.",
        ],
      },
      { type: "tip", text: "Leave out any document you do not have. The checks that depend on it show as “not checked” rather than “passed”." },
      { type: "p", text: "When you are done, click “{{btn.saveRun}}”." },
    ],
  },
  {
    id: "step-result",
    title: "Step 4: Understand the result",
    blocks: [
      { type: "p", text: "After “{{btn.saveRun}}” you are taken to “{{tab.result}}”. From top to bottom you see:" },
      {
        type: "list",
        items: [
          "**At the top**: how many discrepancies, risks and items to verify.",
          "“{{result.section.lc}}”: problems with the credit itself.",
          "“{{result.section.docs}}”: problems with the documents. Each lists the **two sides compared** (for example what the credit says and what the invoice says) and what to change. For an action list grouped by document, export the report (Step 5).",
          "**Checklist**: whether each check was “checked” or “not checked”.",
        ],
      },
      { type: "warn", text: "**“{{result.coverage.skipped}}” does not mean “no problem”.** It means you did not enter that data, so nothing was checked. Add the data and click “{{btn.saveRun}}” again." },
      { type: "p", text: "After correcting a document, go back to “{{tab.docs}}”, update it and click “{{btn.saveRun}}” again, repeating until you are satisfied." },
      { type: "warn", text: "**Finding no discrepancies does not mean the documents are perfect.** The software currently checks only the invoice, transport document, insurance document and the credit itself. Packing list, certificate of origin, draft, number of originals and so on are **not yet checked**, so check those yourself." },
    ],
  },
  {
    id: "step-report",
    title: "Step 5: Export a report",
    blocks: [
      { type: "p", text: "At the top of “{{tab.result}}” click “{{report.exportPdf}}” or “{{report.exportWord}}”." },
      {
        type: "list",
        items: ["**PDF**: good for filing or sending to others; it cannot be edited.", "**Word**: can be edited further, for example to add your company letterhead."],
      },
      { type: "p", text: "The report contains the conclusion, the main terms of the credit, the data used, an explanation of every problem, an **action list grouped by document** (you can print it and tick items off), the checklist and a disclaimer. It is produced in the current interface language." },
    ],
  },
  {
    id: "advanced",
    title: "Advanced features (skip these at first)",
    blocks: [
      { type: "p", text: "**Check knowledge base**: if your company has its own checking list, or a customer has special requirements (for example “the B/L must say freight prepaid”), you can upload it and turn it into items that are checked every time." },
      {
        type: "steps",
        items: [
          "Click “{{btn.knowledge}}” on the left, then “{{kb.upload}}”, and choose your list (PDF, Word, text or image).",
          "Click “{{kb.extract}}”; the software splits the list into individual check items.",
          "On the “{{kb.tabItems}}” tab **read each one** to see whether it was split correctly, and click “{{kb.enable}}” on the good ones. **Items that are not enabled are not used**.",
        ],
      },
      { type: "p", text: "There are three kinds of check item: **wording check** (looks for given words in the document; the result is definite), **AI judgement** (asks AI whether the requirement is met; it only ever raises a “to verify” and you must confirm) and **manual check** (something the software cannot check; it just reminds you)." },
      { type: "p", text: "**AI features**: “{{btn.extract}}” and extracting check items both use AI (DeepSeek). First go to “{{btn.settings}}” → “{{settings.tabAi}}”, switch on “{{settings.enable}}” and enter an API key (from your IT department, or apply for one on the DeepSeek platform). Check items of the “AI judgement” kind also call AI on every check, which takes a little longer and costs money. If your company does not allow documents to be sent outside, do not enable it and fill in by hand; the feature may also already be turned off by your administrator." },
    ],
  },
  {
    id: "safety",
    title: "Data safety and backups (please read)",
    blocks: [
      { type: "p", text: "Your cases, document contents and results are **stored encrypted on this computer**, so a copied database file cannot be read." },
      { type: "warn", text: "The encryption key is tied to your **Windows account**. **If you change computer, reinstall Windows or change Windows user and have no backup, the data cannot be recovered.**" },
      {
        type: "steps",
        items: [
          "Open “{{btn.settings}}” → “{{settings.tabData}}” and click “{{sec.exportBackup}}”.",
          "Set a backup password (at least 8 characters) and **keep it somewhere safe**. If you forget it the backup cannot be opened.",
          "Choose where to save (preferably a company drive or an external disk, not the same place as the computer).",
        ],
      },
      { type: "tip", text: "Back up **once a month**. After 30 days without one, the “{{settings.tabData}}” page shows a yellow reminder. To restore click “{{sec.restore}}”, enter the password and choose the backup file; it works the same on a new computer." },
      { type: "p", text: "If on opening you see “Cannot unlock your data”, the key cannot be read. Do not panic: nothing has been changed. Click “{{sec.restore}}” to restore from a backup, or contact your IT department." },
    ],
  },
  {
    id: "faq",
    title: "Frequently asked questions",
    blocks: [
      {
        type: "faq",
        items: [
          { q: "After “{{btn.create}}” it says a field of the credit is missing", a: "The message is incomplete. It needs at least the lines :20: (credit number) and :32B: (currency and amount). Ask the bank for the **complete message**, not just part of it." },
          { q: "What does “{{result.coverage.skipped}}” mean in the result?", a: "You did not enter the data that check needs (for example no insurance document), so the software could not check it. Add the data and click “{{btn.saveRun}}” again. If this deal genuinely has no such document you can ignore it." },
          { q: "The software found no discrepancies. Is it safe to present?", a: "Not entirely. It only checks what it covers (see the last warning in Step 4), and the bank makes its own judgement. Think of the software as **an extra pair of eyes**, not the final word." },
          { q: "What if what AI filled in does not match the document?", a: "AI makes mistakes. Go by the **original document** and correct the form directly. If you do not trust it, do not use AI and fill everything in by hand." },
          { q: "A scan is read badly, with many wrong characters", a: "Three things to try: ① click “{{btn.viewText}}” and correct it by hand; ② use a clearer scan (upright, not skewed, no shadows); ③ in “{{btn.settings}}” → “{{settings.tabOcr}}”, if the documents contain Chinese, change the language to “English + Simplified Chinese”." },
          { q: "Is my document content sent over the internet?", a: "**Only if you have enabled the AI features** and click “{{btn.extract}}” or extract check items does the relevant text go to the AI service (DeepSeek). Before sending, bank accounts, e-mails and phone numbers are masked by default. What was sent each time can be seen under “{{btn.settings}}” → “Outbound data log”. With AI off, nothing leaves your computer. Reading text from scans always happens on your own computer." },
          { q: "Can I show this report to the bank?", a: "We do not recommend it. It is for your **internal self-check**, better sent to colleagues, documentation staff or customers to discuss what needs changing." },
          { q: "How do I delete a case?", a: "In the case list on the left, click the trash icon at the right of its row. This also deletes its documents and check history, and **cannot be undone**." },
          { q: "How do I switch between Chinese and English?", a: "Use “中文 / English” on the left, or the “Language” item in the top menu. Reports are also produced in the current language." },
          { q: "How do I update the software?", a: "Go to “{{btn.settings}}” → “{{settings.tabUpdate}}” and click “Check for updates”. Updates are downloaded and installed only after you confirm and never restart suddenly. If it says your administrator has not configured an update source, your company manages updates centrally; contact IT." },
        ],
      },
      { type: "p", text: "Still stuck? Contact your company's IT or documentation supervisor and give them the software version (shown under “{{btn.settings}}” → “{{settings.tabUpdate}}”)." },
    ],
  },
  {
    id: "terms",
    title: "Glossary",
    blocks: [
      {
        type: "terms",
        items: [
          { term: "Letter of credit (L/C)", desc: "A payment undertaking issued by a bank at the importer's (your customer's) request: if the documents you present **strictly comply** with the credit, the bank pays." },
          { term: "Beneficiary", desc: "The party who gets paid, normally your company (the exporter)." },
          { term: "Applicant", desc: "The party who applied for the credit, normally your customer (the importer)." },
          { term: "Presentation", desc: "Handing the invoice, bill of lading, insurance document and so on to the bank and asking for payment." },
          { term: "Discrepancy", desc: "Something in the documents that does not match what the credit requires. Even one is enough for the bank to refuse payment." },
          { term: "Compliant documents", desc: "Documents consistent with the credit and also consistent with each other." },
          { term: "Expiry date", desc: "The last day documents can be presented under the credit. Also look at the “place of expiry”: documents must **reach a bank in that city** by then." },
          { term: "Latest shipment date", desc: "The last day the goods may be loaded (or dispatched)." },
          { term: "Presentation period", desc: "How many days after shipment the documents must be presented. If the credit does not say, it is 21 days." },
          { term: "Bill of lading (B/L)", desc: "The receipt for the goods issued by the carrier, and also the document of title." },
          { term: "Commercial invoice", desc: "The seller's bill to the buyer, stating goods, quantity, unit price and total." },
          { term: "Insurance document", desc: "Proof of cargo insurance. Only needed when the credit requires you to insure." },
          { term: "Soft clause", desc: "A term whose fulfilment depends on the customer rather than on you, for example “inspection certificate must be signed by the buyer”. It can make the credit worthless, so ask for it to be amended early." },
          { term: "UCP 600", desc: "The Uniform Customs and Practice for Documentary Credits issued by the ICC, the main basis for banks worldwide when examining documents. Most of the software's checks are based on it." },
          { term: "MT700", desc: "The message format banks use between themselves to issue a credit. This is the kind of text you need to import." },
          { term: "L/C review / document check", desc: "L/C review checks the credit itself. Document check examines the documents you are about to present." },
          { term: "OCR (text recognition)", desc: "Technology that reads text out of scans and images. It runs on your own computer and nothing is uploaded." },
          { term: "Masking", desc: "Hiding bank accounts, e-mails, phone numbers and similar details before text is sent to AI." },
        ],
      },
    ],
  },
];

export const GUIDE: Record<Language, Section[]> = { zh, en };

/** 首页快速入门用的步骤（即指南「快速上手」一节的步骤） */
export function quickStartSteps(lang: Language): string[] {
  const block = GUIDE[lang].find((s) => s.id === "quickstart")?.blocks.find((b) => b.type === "steps");
  return block && block.type === "steps" ? block.items : [];
}

/** 把指南文字里的 {{key}} 换成界面上的真实文案 */
export function resolveGuideText(text: string, dict: Record<string, string>): string {
  return text.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => dict[key] ?? `{{${key}}}`);
}

/** 一个区块里所有文字（用于搜索与测试） */
export function blockTexts(b: Block): string[] {
  switch (b.type) {
    case "p":
    case "tip":
    case "warn":
    case "note":
      return [b.text];
    case "steps":
    case "list":
      return b.items;
    case "severity":
      return b.items.map((i) => i.desc);
    case "terms":
      return b.items.flatMap((i) => [i.term, i.desc]);
    case "faq":
      return b.items.flatMap((i) => [i.q, i.a]);
  }
}

/** 搜索：返回标题或正文含关键词的小节（忽略大小写与 ** 标记） */
export function searchGuide(lang: Language, dict: Record<string, string>, query: string): Section[] {
  const q = query.trim().toLowerCase();
  if (!q) return GUIDE[lang];
  const clean = (s: string) => resolveGuideText(s, dict).replace(/\*\*/g, "").toLowerCase();
  return GUIDE[lang].filter((sec) => clean(sec.title).includes(q) || sec.blocks.some((b) => blockTexts(b).some((t) => clean(t).includes(q))));
}
