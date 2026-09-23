"use strict";
/**
 * 课堂笔记阅读栏的视觉夹具：真 DOM、真样式、假 Obsidian。
 *
 *   node tools/reading-rail-visual.cjs
 *
 * 两种模式各起一遍：编辑模式用一个 .cm-scroller 加一个假的 EditorView（posAtDOM / lineAt），
 * 阅读模式用 post processor 留下的 section 信息。getScroll / applyScroll 按「data-line 的块在屏幕顶上」
 * 换算行号，和 Obsidian 两种模式的约定一样按行计。
 * 截图写到 D:/codex/workbench-checks/reading-rail。
 */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "C:/Users/longf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(__dirname, ".."), out = "D:/codex/workbench-checks/reading-rail";
fs.mkdirSync(out, { recursive: true });

const NOTE = [
  "---", "type: class-note", "cssclasses:", "  - class-note", "---",
  "# 流体力学与化工基础 · 9 月 22 日（周二）", "",
  "10:15–13:15 · B.5.3 · Via Bonardi · [[课程主页]]", "",
  "## 课堂记录", "",
  "### 习题课 E01：宏观物料衡算（例 2、3、5）", "",
  "> [!tip] 三题共用的解题顺序", "> 先画**控制体边界与流股**，再选基准，最后列「总量衡算 + 关键组分衡算」。", "",
  "#### 例 2：带回流的分流网络（原讲义 Esercizio 2，PDF 第 4–5 页）", "",
  "![例 2 原题流程图](_assets/例2-流程图.svg)", "",
  "图中数字是流股编号，百分数是该节点出口占入口的质量流率比例。", "",
  "先用手指沿箭头走一圈。主路是 1 → 设备 1 → 2 → (3, 4)；3 经过设备 2 分成回流 5 和流向汇合点的 6。", "",
  "$$", "\\dot m_2 = \\dot m_1 + \\dot m_5 + \\dot m_{13}", "$$", "",
  "| 流股 | 从哪里到哪里 | 比例 |", "|---|---|---|", "| 3 | 2 → 设备 2 | 30% |", "| 4 | 2 → 汇合点 | 70% |", "",
  ...Array.from({ length: 8 }, (_, i) => [`第 ${i + 1} 步：把已知条件写在旁边，再对每个节点分别列质量守恒。检查单位是否一致，再核对所有入口与出口的总量是否相等，这一步只关心流量的分配比例。`, ""]).flat(),
  "#### 例 3：油籽萃取、过滤与溶剂回收（原讲义 Esercizio 3，PDF 第 6–7 页）", "",
  "先读题，确认哪些是已知量。", "",
  "![[例3-萃取.svg]]", "",
  ...Array.from({ length: 8 }, (_, i) => [`例 3 推导 ${i + 1}：溶剂在过滤器和蒸发器之间循环，整体衡算里它互相抵消，只剩进料、产品和废渣三股。`, ""]).flat(),
  "## 课后总结", "", "回流在全装置衡算里抵消；百分数先认清分母。",
].join("\n");

const svg = (title, color) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420"><rect width="800" height="420" fill="white"/><g fill="none" stroke="${color}" stroke-width="3"><path d="M40 210H170M330 210H460M620 210H760M540 160V60H250V160"/><rect x="170" y="160" width="160" height="100" rx="8"/><rect x="460" y="160" width="160" height="100" rx="8"/></g><g font-family="Arial" text-anchor="middle" fill="#1c1c1e" font-size="26"><text x="250" y="218">Reattore 1</text><text x="540" y="218">Reattore 2</text><text x="400" y="46">${title}</text><text x="100" y="190">100 kg/h</text></g></svg>`);

// lucide 的几枚图标（夹具里 setIcon 用；真 Obsidian 自带整套）。
const ICONS = {
  "maximize-2": '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/>',
  "minimize-2": '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>',
  "panel-right-close": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m8 9 3 3-3 3"/>',
  "panel-right-open": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  pin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
  "pin-off": '<line x1="2" x2="22" y1="2" y2="22"/><line x1="12" x2="12" y1="17" y2="22"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12"/><path d="M15 9.34V6h1a2 2 0 0 0 0-4H7.89"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  locate: '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/>',
};

const BASE_CSS = `*{box-sizing:border-box}html,body{margin:0;height:100%}
body{font-family:'Segoe UI','Microsoft YaHei',sans-serif;background:#fff;color:#222;--background-primary:#fff;font-size:16px}
body.theme-dark{background:#1e1e1e;color:#dadada;--background-primary:#1e1e1e}
.app{display:flex;height:100vh}.workspace-ribbon{width:44px;border-right:1px solid #e3e3e3;flex:none}
.main{flex:1;display:flex;flex-direction:column;min-width:0}.workspace-tab-header-container{height:40px;border-bottom:1px solid #e3e3e3;flex:none}
.workspace-leaf{flex:1;display:flex;min-height:0}.workspace-leaf-content{flex:1;display:flex;flex-direction:column;min-width:0}
.view-header{height:40px;flex:none;padding:10px 24px;font-size:13px;color:#666}.view-content{flex:1;min-height:0}
.status-bar{height:26px;border-top:1px solid #e3e3e3;flex:none}
.markdown-reading-view,.markdown-source-view{height:100%}.markdown-preview-view,.cm-scroller{height:100%;overflow:auto;padding:24px 40px 120px}
.cm-editor{height:100%}.cm-content{outline:none}
h1{font-size:var(--h1-size);font-weight:var(--h1-weight)}h2{font-size:var(--h2-size)}h3{font-size:var(--h3-size)}h4{font-size:var(--h4-size)}
p{line-height:var(--line-height-normal,1.6)}
.callout{padding:var(--callout-padding);border-radius:var(--callout-radius);--callout-color:0,191,188;margin:1em 0}.callout-title{font-weight:var(--callout-title-weight);color:rgb(var(--callout-color))}
.math-block{text-align:center;padding:14px 0;font-family:'Cambria Math',serif;font-size:19px}
table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px 10px}th{background:var(--table-header-background)}
.image-embed img{max-width:100%;display:block;margin:10px auto;border-radius:14px}
.modal-container{position:fixed;inset:0;background:#0005;display:grid;place-items:center;z-index:30}.modal{position:relative;overflow:hidden}`;

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setContent(`<div class="app"><div class="workspace-ribbon mod-left"></div><div class="main"><div class="workspace-tab-header-container"></div>
      <div class="workspace-leaf"><div class="workspace-leaf-content" data-type="markdown"><div class="view-header">03 知识库 / 我的课程 / 课堂笔记 / 2026-09-22 流体力学与化工基础</div>
      <div class="view-content"><div class="markdown-source-view mod-cm6 class-note"><div class="cm-editor"><div class="cm-scroller"><div class="cm-sizer"><div class="cm-content" contenteditable="true"></div></div></div></div></div>
      <div class="markdown-reading-view" style="display:none"><div class="markdown-preview-view class-note"><div class="markdown-preview-sizer"></div></div></div></div></div></div>
      <div class="status-bar"></div></div></div>`);
    await page.addStyleTag({ content: BASE_CSS });
    for (const file of ["shared/tokens.css", "shared/components.css", "codex-workbench/styles.css", "codex-workbench/reading-rail.css"]) {
      await page.addStyleTag({ content: fs.readFileSync(path.join(root, file), "utf8") });
    }
    await page.evaluate(({ NOTE, ICONS, fig2, fig3 }) => {
      window.NOTE = NOTE; window.ICONS = ICONS;
      const lines = NOTE.split("\n");
      // 把源码切成块，每块一个带 data-line 的元素。两种模式各画一份。
      const blocks = [];
      for (let i = 5; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        let j = i;
        if (lines[i] === "$$") { j = lines.indexOf("$$", i + 1); }
        else while (j + 1 < lines.length && lines[j + 1].trim() && !/^#/.test(lines[j + 1]) && !/^#/.test(lines[i])) j++;
        blocks.push({ start: i, end: j, text: lines.slice(i, j + 1).join("\n") });
        i = j;
      }
      const draw = (parent) => blocks.forEach((b) => {
        const div = document.createElement("div");
        div.className = "section cm-line"; div.dataset.line = String(b.start); div.dataset.end = String(b.end);
        const t = b.text, h = /^(#+)\s+(.*)$/.exec(t);
        if (h) { const e = document.createElement("h" + h[1].length); e.textContent = h[2]; div.append(e); }
        else if (t.startsWith("![")) {
          const embed = document.createElement("span"); embed.className = "internal-embed image-embed";
          const src = t.startsWith("![[") ? t.slice(3, -2) : /\((.*)\)/.exec(t)[1];
          embed.setAttribute("src", src);
          const img = document.createElement("img"); img.src = src.includes("例2") ? fig2 : fig3; embed.append(img); div.append(embed);
        } else if (t.startsWith("$$")) { const m = document.createElement("div"); m.className = "math math-block"; m.textContent = "ṁ₂ = ṁ₁ + ṁ₅ + ṁ₁₃"; div.append(m); }
        else if (t.startsWith("|")) {
          const table = document.createElement("table");
          t.split("\n").filter((r) => !/^\|-/.test(r)).forEach((r, k) => { const tr = table.insertRow(); r.split("|").slice(1, -1).forEach((c) => { const cell = document.createElement(k ? "td" : "th"); cell.textContent = c.trim(); tr.append(cell); }); });
          div.append(table);
        } else if (t.startsWith("> [!")) {
          const c = document.createElement("div"); c.className = "callout"; c.dataset.callout = "tip";
          const title = document.createElement("div"); title.className = "callout-title"; title.textContent = /\]\s*(.*)/.exec(t.split("\n")[0])[1];
          const body = document.createElement("div"); body.className = "callout-content"; body.textContent = t.split("\n").slice(1).join(" ").replace(/^>\s*/, "").replace(/\*\*/g, "");
          c.append(title, body); div.append(c);
        } else { const p = document.createElement("p"); p.textContent = t.replace(/\[\[(.*?)\]\]/g, "$1"); div.append(p); }
        parent.append(div);
      });
      draw(document.querySelector(".cm-content"));
      draw(document.querySelector(".markdown-preview-sizer"));

      const scroller = () => window.mode === "preview" ? document.querySelector(".markdown-preview-view") : document.querySelector(".cm-scroller");
      const sections = () => [...scroller().querySelectorAll("[data-line]")];
      const subView = {
        getScroll() {
          const top = scroller().getBoundingClientRect().top;
          const list = sections();
          const s = list.find((e) => e.getBoundingClientRect().bottom > top + 1) || list.at(-1);
          const r = s.getBoundingClientRect();
          const span = Number(s.dataset.end) - Number(s.dataset.line) + 1;
          return Number(s.dataset.line) + Math.max(0, Math.min(1, (top - r.top) / r.height)) * span;
        },
        applyScroll(line) {
          const s = sections().filter((e) => Number(e.dataset.line) <= line).at(-1);
          const sc = scroller();
          sc.scrollTop += s.getBoundingClientRect().top - sc.getBoundingClientRect().top;
          window.applied = line;
        },
      };
      window.mode = "source";
      const setMode = (next) => {
        window.mode = next;
        document.querySelector(".markdown-source-view").style.display = next === "source" ? "" : "none";
        document.querySelector(".markdown-reading-view").style.display = next === "preview" ? "" : "none";
      };
      window.setMode = setMode;
      window.cm = {
        posAtDOM(node) { const s = node.closest("[data-line]"); return Number(s.dataset.line); },
        state: { doc: { lineAt: (pos) => ({ number: pos + 1 }) } },
      };
      window.events = {}; window.commands = {}; window.post = []; window.cleanup = []; window.saved = 0; window.splits = [];
      const on = (name, fn) => { (events[name] ||= []).push(fn); return {}; };
      window.fire = (name, ...args) => (events[name] || []).forEach((fn) => fn(...args));
      window.MarkdownView = class {};
      const view = Object.assign(new MarkdownView(), {
        file: { path: "03 知识库/我的课程/2026-27/课堂笔记/089257 流体力学与化工基础/2026-09-22 流体力学与化工基础.md", extension: "md" },
        contentEl: document.querySelector(".view-content"),
        getMode: () => window.mode,
        get currentMode() { return subView; },
        getViewData: () => NOTE,
        editor: { cm, getSelection: () => window.editorSelection || "", getCursor: () => ({ line: window.cursorLine || 0, ch: 0 }) },
      });
      window.leaf = { view, containerEl: document.querySelector(".workspace-leaf") };
      const split = (name) => ({ collapsed: false, collapse() { this.collapsed = true; splits.push(name + ":collapse"); }, expand() { this.collapsed = false; splits.push(name + ":expand"); } });
      window.p = {
        data: {},
        app: {
          workspace: { on, getLeavesOfType: () => (window.noLeaf ? [] : [leaf]), onLayoutReady: (fn) => fn(), activeLeaf: leaf, getActiveViewOfType: () => view, leftSplit: split("left"), rightSplit: split("right") },
          metadataCache: { on }, vault: { on },
        },
        save: async () => { saved++; }, register: (f) => cleanup.push(f), registerEvent() {},
        registerMarkdownPostProcessor: (f) => post.push(f),
        addCommand: (c) => { commands[c.id] = c; },
      };
      window.MockModal = class {
        constructor(app) { this.app = app; this.containerEl = document.createElement("div"); this.containerEl.className = "modal-container"; this.modalEl = document.createElement("div"); this.modalEl.className = "modal"; this.contentEl = document.createElement("div"); this.contentEl.className = "modal-content"; this.modalEl.append(this.contentEl); this.containerEl.append(this.modalEl); }
        open() { document.body.append(this.containerEl); this.onOpen(); }
        close() { this.onClose(); this.containerEl.remove(); }
      };
      window.setIcon = (node, name) => { node.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" data-icon="${name}">${ICONS[name] || '<circle cx="12" cy="12" r="8"/>'}</svg>`); };
      window.md = {
        markdownOwner: () => ({ unload() { window.unloaded = (window.unloaded || 0) + 1; } }),
        renderMarkdown(app, owner, target, text) {
          target.replaceChildren(); target.classList.add("markdown-rendered");
          const image = /!\[\[(.*?)\]\]|!\[[^\]]*\]\((.*?)\)/.exec(text);
          if (image && text.trim().split("\n").length === 1) { const img = document.createElement("img"); img.src = (image[1] || image[2]).includes("例2") ? fig2 : fig3; target.append(img); return; }
          if (text.startsWith("$$")) { const m = document.createElement("div"); m.className = "math math-block"; m.textContent = "ṁ₂ = ṁ₁ + ṁ₅ + ṁ₁₃"; target.append(m); return; }
          const para = document.createElement("p"); para.textContent = text; target.append(para);
        },
      };
    }, { NOTE, ICONS, fig2: svg("例 2 · 35% recycle", "#245ea8"), fig3: svg("例 3 · 萃取", "#23865A") });

    for (const [name, file] of [["dom", "shared/dom.js"], ["model", "codex-workbench/reading-rail-model.js"], ["railModule", "codex-workbench/reading-rail.js"]]) {
      await page.addScriptTag({ content: `window.${name}=(()=>{const module={exports:{}};const require=n=>n==='obsidian'?{MarkdownView:window.MarkdownView,Modal:MockModal,Notice:class{constructor(t){window.notice=t;}},setIcon:window.setIcon}:n.includes('shared/dom')?window.dom:n.includes('markdown-render')?window.md:window.model;${fs.readFileSync(path.join(root, file), "utf8")};return module.exports;})();` });
    }
    const rail = () => page.locator(".lr-rail");
    const scrollTo = (line) => page.evaluate((line) => { const sc = window.mode === "preview" ? document.querySelector(".markdown-preview-view") : document.querySelector(".cm-scroller"); const s = [...sc.querySelectorAll("[data-line]")].filter((e) => Number(e.dataset.line) <= line).at(-1); sc.scrollTop += s.getBoundingClientRect().top - sc.getBoundingClientRect().top; }, line);
    const settle = () => page.waitForTimeout(120);
    const pins = () => page.evaluate(() => p.data.noteReading.pins[leaf.view.file.path]);
    const line = (text) => NOTE.split("\n").findIndex((l) => l.includes(text));

    await page.evaluate(() => { window.rail = new railModule.ReadingRail(p); rail.start(); });

    // 1. 编辑模式下就在：上一稿必须切到阅读模式。
    await rail().waitFor();
    assert.equal(await page.evaluate(() => window.mode), "source");
    // 唯一的 H1 是标题，不进目录。
    const headings = await page.locator(".lr-heading").allTextContents();
    assert.deepEqual(headings.map((h) => h.slice(0, 4)), ["课堂记录", "习题课 ", "例 2：", "例 3：", "课后总结"]);
    assert.ok(await page.locator(".lr-card").isHidden(), "没滚过题图时不出卡");
    assert.ok(await page.locator(".lr-hint").isVisible(), "没钉过时有一行提示");

    // 2. 题图跟随：滚过例 2 的图出现，进例 3 收掉，滚过例 3 的图换成例 3。
    await scrollTo(line("第 3 步")); await settle();
    assert.ok(await page.locator(".lr-card").isVisible(), "例 2 的图滚出屏幕后出现在栏里");
    assert.equal(await page.locator(".lr-card-kind").textContent(), "本节题图");
    assert.match(await page.locator(".lr-card-context").textContent(), /^例 2/);
    assert.equal(await page.locator(".lr-row.is-active .lr-heading").textContent(), headings[2]);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, "edit-follow-light.png") });
    await scrollTo(line("先读题")); await settle();
    assert.ok(await page.locator(".lr-card").isHidden(), "进了例 3，例 2 的图收掉");
    await scrollTo(line("例 3 推导 2")); await settle();
    assert.match(await page.locator(".lr-card-context").textContent(), /^例 3/);

    // 3. 悬停公式出「钉住」，一下钉住；钉住的压过跟随。
    await scrollTo(line("例 2：")); await settle();
    const math = page.locator(".cm-content .math-block");
    await math.scrollIntoViewIfNeeded(); await math.hover();
    await page.locator(".lr-pin-float").waitFor();
    const float = await page.locator(".lr-pin-float").boundingBox(), mb = await math.boundingBox();
    assert.ok(float.x + float.width <= mb.x + mb.width && float.y >= mb.y - 1, "浮钮在公式右上角里面");
    await page.locator(".lr-pin-float").click();
    assert.match((await pins()).markdown, /^\$\$\n\\dot m_2/);
    assert.equal(await page.locator(".lr-card-kind").textContent(), "已钉住 · 公式");
    assert.ok(await page.locator(".lr-hint").isHidden(), "钉过一次，提示不再出现");
    await scrollTo(line("例 3 推导 2")); await settle();
    assert.equal(await page.locator(".lr-card-kind").textContent(), "已钉住 · 公式", "跟随不顶掉钉住的");
    await page.screenshot({ path: path.join(out, "edit-pinned-light.png") });
    await page.getByRole("button", { name: "取消钉住" }).click(); await settle();
    assert.equal(await pins(), undefined);
    assert.equal(await page.locator(".lr-card-kind").textContent(), "本节题图", "取消钉住后回到跟随");

    // 4. 目录跳转走 applyScroll，当前章节马上亮。
    await page.getByRole("button", { name: headings[4] }).click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.applied), line("## 课后总结"));
    assert.equal(await page.locator(".lr-row.is-active .lr-heading").textContent(), headings[4]);
    // 折叠「课堂记录」藏起它下面的三行。
    await page.getByRole("button", { name: "折叠 课堂记录" }).click();
    assert.equal(await page.locator(".lr-heading").count(), 2);
    await page.getByRole("button", { name: "展开 课堂记录" }).click();
    assert.equal(await page.locator(".lr-heading").count(), 5);

    // 5. 命令：编辑模式没有选区时钉光标所在的块。
    await page.evaluate((l) => { window.cursorLine = l; commands["reading-pin"].checkCallback(false); }, line("| 3 |")); await settle();
    assert.match((await pins()).markdown, /^\| 流股/);
    assert.equal(await page.locator(".lr-card-kind").textContent(), "已钉住 · 表格");

    // 6. 切到阅读模式：栏不走，悬停图片只钉这张图。
    await page.evaluate(() => { setMode("preview"); fire("layout-change"); });
    await page.waitForTimeout(150);
    await page.evaluate(() => { for (const s of document.querySelectorAll(".markdown-preview-sizer [data-line]")) post.forEach((fn) => fn(s, { sourcePath: leaf.view.file.path, getSectionInfo: () => ({ lineStart: Number(s.dataset.line), lineEnd: Number(s.dataset.end), text: NOTE }) })); });
    assert.equal(await rail().count(), 1);
    await scrollTo(line("例 2：")); await settle();
    const img = page.locator(".markdown-preview-view img").first();
    await page.evaluate(() => { window.imgClicks = 0; document.querySelectorAll(".markdown-preview-view img").forEach((i) => i.addEventListener("click", () => imgClicks++)); });
    await img.hover(); await page.locator(".lr-pin-float").click();
    assert.equal((await pins()).markdown, "![例 2 原题流程图](_assets/例2-流程图.svg)");
    // 实机上这一下曾穿透到图片，打开了 Obsidian 的图片灯箱。
    assert.equal(await page.evaluate(() => window.imgClicks), 0, "按「钉住」不许点到底下的图");
    assert.equal(await page.locator(".lr-card-kind").textContent(), "已钉住 · 图");
    await page.getByRole("button", { name: "放大查看" }).click();
    assert.ok(await page.locator(".lr-figure-modal img").isVisible());
    await page.screenshot({ path: path.join(out, "figure-modal.png") });
    await page.evaluate(() => document.querySelector(".modal-container").remove());

    // 7. 沉浸：收左右栏、藏功能区与状态栏；Esc 退出并还原。
    await page.getByRole("button", { name: "沉浸阅读" }).click();
    assert.ok(await page.evaluate(() => document.body.classList.contains("lr-immersive")));
    assert.ok(await page.locator(".status-bar").isHidden());
    assert.deepEqual(await page.evaluate(() => splits), ["left:collapse", "right:collapse"]);
    await page.mouse.move(800, 600); await page.waitForTimeout(400);
    assert.equal(await page.locator(".view-header").evaluate((e) => getComputedStyle(e).opacity), "0");
    await page.screenshot({ path: path.join(out, "immersive-light.png") });
    // Obsidian 的按键处理会先把 Esc 标成已处理——实机上第一版的 Esc 因此退不出沉浸。
    await page.evaluate(() => document.addEventListener("keydown", (e) => { if (e.key === "Escape") e.preventDefault(); }, true));
    await page.keyboard.press("Escape");
    assert.ok(!(await page.evaluate(() => document.body.classList.contains("lr-immersive"))));
    assert.deepEqual(await page.evaluate(() => splits.slice(2)), ["left:expand", "right:expand"]);

    // 8. 栏宽键盘可调；收起后正文仍然限宽居中，右上角留一个打开的按钮。
    await page.getByRole("separator").focus(); await page.keyboard.press("ArrowLeft");
    assert.equal(await page.evaluate(() => p.data.noteReading.width), 360);
    await page.getByRole("button", { name: "收起阅读栏" }).click();
    assert.ok(await rail().isHidden());
    const sizer = await page.locator(".markdown-preview-sizer").boundingBox();
    assert.ok(sizer.width <= 760, `正文行宽 ${sizer.width}`);
    await page.getByRole("button", { name: "显示阅读栏" }).click();
    assert.ok(await rail().isVisible());

    // 9. 可读性：栏里每一种字对它真正压着的底 ≥ 4.5（浅色、深色各量一遍）。
    const measure = () => page.evaluate(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const over = (top, under) => { const a = top[3] ?? 1; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)); };
      const bgOf = (node) => { const stack = []; for (let n = node; n; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0) stack.push(c); if (c.length === 3 || c[3] === 1) break; } let base = rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3); for (const c of stack.reverse()) base = over(c, base); return base; };
      const out = {};
      for (const sel of [".lr-bar-title", ".lr-row.is-top .lr-heading", ".lr-row:not(.is-top):not(.is-active) .lr-heading", ".lr-row.is-active .lr-heading", ".lr-card-kind", ".lr-card-context"]) {
        const node = document.querySelector(sel); if (!node || !node.offsetParent) continue;
        const fg = over(rgb(getComputedStyle(node).color), bgOf(node)), bg = bgOf(node);
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        out[sel] = +((a + 0.05) / (b + 0.05)).toFixed(2);
      }
      return out;
    });
    await scrollTo(line("第 3 步")); await settle();
    const light = await measure();
    await page.evaluate(() => document.body.classList.add("theme-dark"));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, "reading-dark.png") });
    const dark = await measure();
    for (const [theme, values] of [["浅色", light], ["深色", dark]]) {
      assert.ok(Object.keys(values).length >= 5, `${theme}量到的锚点太少：${JSON.stringify(values)}`);
      for (const [sel, ratio] of Object.entries(values)) assert.ok(ratio >= 4.5, `${theme} ${sel} 只有 ${ratio}`);
    }
    await page.evaluate(() => document.body.classList.remove("theme-dark"));

    // 10. 窄窗口：栏收成抽屉，按钮拉出来，Esc 收回；卸载清干净。
    await page.setViewportSize({ width: 900, height: 820 }); await page.waitForTimeout(150);
    assert.ok(await rail().isHidden());
    await page.getByRole("button", { name: "显示阅读栏" }).click(); await page.waitForTimeout(300);
    assert.ok(await rail().isVisible());
    await page.screenshot({ path: path.join(out, "narrow-drawer.png") });
    await page.keyboard.press("Escape");
    assert.ok(await rail().isHidden());
    await page.evaluate(() => { window.noLeaf = true; rail.sync(); });
    assert.equal(await page.locator(".lr-rail,.lr-reopen,.lr-pin-float").count(), 0);
    assert.ok(!(await page.locator(".view-content").evaluate((e) => e.classList.contains("lr-host"))));
    assert.deepEqual(errors, []);
    console.log("阅读栏：编辑 / 阅读两种模式挂载、题图跟随、悬停钉住、命令钉块、目录跳转与折叠、沉浸、栏宽、窄窗抽屉、可读性（浅色 %j，深色 %j）全部通过。", light, dark);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
