"use strict";
/**
 * 课堂笔记阅读栏的视觉夹具：真 DOM、真样式、假 Obsidian。
 *
 *   node tools/reading-rail-visual.cjs
 *
 * 两种模式各起一遍：编辑模式用一个 .cm-scroller 加一个假的 EditorView（posAtDOM / lineAt），
 * 阅读模式用 post processor 留下的 section 信息。getScroll / applyScroll 按「data-line 的块在屏幕顶上」
 * 换算行号，和 Obsidian 两种模式的约定一样按行计。
 * 截图写到仓库旁边的 workbench-checks/reading-rail（和 smoke-visual、check-note-pages 同一个上级目录）。
 */
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "C:/Users/longf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(__dirname, ".."), out = path.resolve(root, "../../workbench-checks/reading-rail");
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
  "**题目**：进料 1 为 100 kg/h，按图中比例求各流股的质量流率。", "",
  "先用手指沿箭头走一圈。主路是 1 → 设备 1 → 2 → (3, 4)；3 经过设备 2 分成回流 5 和流向汇合点的 6。", "",
  "$$", "\\dot m_2 = \\dot m_1 + \\dot m_5 + \\dot m_{13}", "$$", "",
  "| 流股 | 从哪里到哪里 | 比例 |", "|---|---|---|", "| 3 | 2 → 设备 2 | 30% |", "| 4 | 2 → 汇合点 | 70% |", "",
  ...Array.from({ length: 8 }, (_, i) => [`第 ${i + 1} 步：把已知条件写在旁边，再对每个节点分别列质量守恒。检查单位是否一致，再核对所有入口与出口的总量是否相等，这一步只关心流量的分配比例。`, ""]).flat(),
  "#### 例 3：油籽萃取、过滤与溶剂回收（原讲义 Esercizio 3，PDF 第 6–7 页）", "",
  "先读题，确认哪些是已知量。", "",
  "![[例3-萃取.svg]]", "",
  "![[例3-萃取-蒸发器.svg|蒸发器细部]]", "",
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
  "chevrons-up-down": '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  "chevrons-down-up": '<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>',
  "panel-left-close": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/>',
  "panel-left-open": '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="m14 9 3 3-3 3"/>',
  "book-open": '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  "chevron-down":'<path d="m6 9 6 6 6-6"/>',
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
    for (const file of ["shared/tokens.css", "shared/components.css", "l-os-workbench/styles.css", "l-os-workbench/reading-rail.css"]) {
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
        // 翻页先关着：前面各节按滚动写的断言不受它影响，翻页在第 10 节单独测。
        data: { noteReading: { paged: false } },
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
        // 按空行分块渲染，和真渲染器一样：一行图片是图，$$ 是公式，其余是段落。
        renderMarkdown(app, owner, target, text) {
          target.replaceChildren(); target.classList.add("markdown-rendered");
          for (const chunk of text.split(/\n\s*\n/)) {
            const image = /^!\[\[(.*?)\]\]$|^!\[[^\]]*\]\((.*?)\)$/.exec(chunk.trim());
            if (image) { const img = document.createElement("img"); img.src = (image[1] || image[2]).includes("例2") ? fig2 : fig3; target.append(img); continue; }
            if (chunk.startsWith("$$")) { const m = document.createElement("div"); m.className = "math math-block"; m.textContent = "ṁ₂ = ṁ₁ + ṁ₅ + ṁ₁₃"; target.append(m); continue; }
            const para = document.createElement("p"); para.textContent = chunk; target.append(para);
          }
        },
      };
    }, { NOTE, ICONS, fig2: svg("例 2 · 35% recycle", "#245ea8"), fig3: svg("例 3 · 萃取", "#23865A") });

    for (const [name, file] of [["dom", "shared/dom.js"], ["model", "l-os-workbench/reading-rail-model.js"], ["pagerModule", "l-os-workbench/reading-pager.js"], ["railModule", "l-os-workbench/reading-rail.js"]]) {
      await page.addScriptTag({ content: `window.${name}=(()=>{const module={exports:{}};const require=n=>n==='obsidian'?{MarkdownView:window.MarkdownView,Modal:MockModal,Notice:class{constructor(t){window.notice=t;}},setIcon:window.setIcon}:n.includes('shared/dom')?window.dom:n.includes('markdown-render')?window.md:n.includes('reading-pager')?window.pagerModule:window.model;${fs.readFileSync(path.join(root, file), "utf8")};return module.exports;})();` });
    }
    const rail = () => page.locator(".lr-rail");
    const scrollTo = (line) => page.evaluate((line) => { const sc = window.mode === "preview" ? document.querySelector(".markdown-preview-view") : document.querySelector(".cm-scroller"); const s = [...sc.querySelectorAll("[data-line]")].filter((e) => Number(e.dataset.line) <= line).at(-1); sc.scrollTop += s.getBoundingClientRect().top - sc.getBoundingClientRect().top; }, line);
    const settle = () => page.waitForTimeout(120);
    const pins = () => page.evaluate(() => p.data.noteReading.pins[leaf.view.file.path]);
    const line = (text) => NOTE.split("\n").findIndex((l) => l.includes(text));

    await page.evaluate(() => { window.rail = new railModule.ReadingRail(p); rail.start(); });

    // 1. 编辑模式下就在：上一稿必须切到阅读模式。宽窗口下三列：目录在最左，正文居中，题图在最右。
    await rail().waitFor();
    assert.equal(await page.evaluate(() => window.mode), "source");
    assert.ok(await page.locator(".view-content").evaluate((e) => e.classList.contains("lr-three")), "1600 宽应当三列");
    // 唯一的 H1 是标题，不进目录；篇首还没进任何一章，目录全展开。
    const headings = await page.locator(".lr-title").allTextContents();
    assert.deepEqual(headings.map((h) => h.slice(0, 4)), ["课堂记录", "习题课 ", "例 2：", "例 3：", "课后总结"]);
    // 页码拆到右边：「（原讲义 Esercizio 2，PDF 第 4–5 页）」→ 标题留括号里的说明，页码成徽标。
    assert.equal(headings[2], "例 2：带回流的分流网络（原讲义 Esercizio 2）");
    assert.deepEqual(await page.locator(".lr-page").allTextContents(), ["p.4–5", "p.6–7"]);
    const rowHeights = await page.locator(".lr-row").evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
    assert.ok(rowHeights.every((h) => h <= 32), `目录每行一行字：${rowHeights}`);
    // 题图列一直在：这里没有图，说一句，不留空框。
    assert.ok(await page.locator(".lr-card").isVisible());
    assert.match(await page.locator(".lr-empty").textContent(), /^这一节没有图/);
    assert.ok(await page.locator(".lr-card-tools").isHidden(), "没东西时不给钉住 / 放大");
    const cols = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const scroll = (s) => { const e = document.querySelector(s); return e.scrollHeight - e.clientHeight; };
      return { rail: r(".lr-rail"), doc: r(".cm-scroller"), side: r(".lr-side"), card: r(".lr-card"), outline: r(".lr-outline"), sizer: r(".cm-sizer"), railScroll: scroll(".lr-rail"), sideScroll: scroll(".lr-side") };
    });
    assert.ok(cols.rail.left < 60 && cols.rail.right <= cols.doc.left + 1, "目录在最左边");
    assert.ok(cols.side.left >= cols.doc.right - 1, "题图在正文右边");
    assert.ok(Math.abs((cols.sizer.left + cols.sizer.right) / 2 - (cols.doc.left + cols.doc.right) / 2) < 2, "正文在中间一列里居中");
    assert.ok(Math.abs(cols.card.top - cols.outline.top) < 60, "两边顶端对齐");
    // 没拖过题图栏：正文一行 760 之外的白边归题图，正文这一列仍放得下整行。
    assert.ok(cols.side.width > 420, `宽窗口下题图栏自动变宽：${cols.side.width}`);
    assert.ok(cols.doc.width >= 840 - 1, `正文这一列放得下一行 760 加边距：${cols.doc.width}`);
    assert.ok(cols.railScroll <= 1 && cols.sideScroll <= 1, "两栏外层都不滚");
    await page.screenshot({ path: path.join(out, "three-empty-light.png") });

    // 2. 本题卡：读到例 2 的解答（第 3 步），卡片是例 2 的图 + 图注 + 题面；进例 3 换成例 3。
    await scrollTo(line("第 3 步")); await settle();
    assert.equal(await page.locator(".lr-card-kind").textContent(), "本题");
    assert.equal(await page.locator(".lr-card-context").textContent(), headings[2]);
    assert.equal(await page.locator(".lr-fig").count(), 1);
    assert.equal(await page.locator(".lr-fig-caption").textContent(), "例 2 原题流程图", "没有图注时用 alt");
    const stems = await page.locator(".lr-stem").allTextContents();
    assert.equal(stems.length, 2, `「先用手指沿箭头走一圈」是解答，不进题面：${stems}`);
    assert.match(stems[0], /^图中数字是流股编号/, "「图中……」讲的是题给数据，按题面排");
    assert.match(stems[1], /^\*\*题目\*\*：进料 1 为 100 kg\/h/, "题面跟着图");
    assert.ok(await page.locator(".lr-card-note").isHidden(), "图注在图下面，卡底不再重复一句 alt");
    assert.equal(await page.locator(".lr-row.is-active .lr-title").textContent(), headings[2]);
    assert.equal(await page.getByRole("button", { name: "钉住这道题" }).count(), 1);
    const order = await page.evaluate(() => { const y = (s) => document.querySelector(s).getBoundingClientRect().top; return [y(".lr-fig-image img"), y(".lr-fig-caption"), y(".lr-stem")]; });
    assert.ok(order[0] < order[1] && order[1] < order[2], `图、图注、题面从上往下：${order}`);
    await page.waitForTimeout(350);
    const fit = await page.evaluate(() => {
      const body = document.querySelector(".lr-card-body").getBoundingClientRect(), img = document.querySelector(".lr-card-body img").getBoundingClientRect();
      return { body, img };
    });
    assert.ok(fit.img.width > 300 && fit.img.right <= fit.body.right + 1 && fit.img.bottom <= fit.body.bottom + 1 && fit.img.top >= fit.body.top - 1, `图撑满栏宽、整张放得下：${JSON.stringify(fit)}`);
    assert.ok(fit.img.top - fit.body.top < 12, `图顶着卡身排，不在一整栏里居中：${fit.img.top - fit.body.top}`);
    await page.screenshot({ path: path.join(out, "edit-follow-light.png") });
    // 目录很长时两列各滚各的：题图不动，外层不滚。
    const long = await page.evaluate(() => {
      const outline = document.querySelector(".lr-outline"), extra = [];
      for (let i = 0; i < 60; i++) { const row = outline.lastElementChild.cloneNode(true); outline.append(row); extra.push(row); }
      const rail = document.querySelector(".lr-rail"), img = document.querySelector(".lr-card-body img").getBoundingClientRect();
      const result = { outlineScrolls: outline.scrollHeight > outline.clientHeight, railScroll: rail.scrollHeight - rail.clientHeight, img: img.height, pad: getComputedStyle(outline).paddingBottom };
      extra.forEach((row) => row.remove());
      return result;
    });
    assert.ok(long.outlineScrolls && long.railScroll <= 1 && long.img > 100, `长目录：${JSON.stringify(long)}`);
    assert.equal(long.pad, "24px", "目录底部留白");
    await scrollTo(line("先读题")); await settle();
    assert.equal(await page.locator(".lr-card-context").textContent(), "例 3：油籽萃取、过滤与溶剂回收（原讲义 Esercizio 3）", "进了例 3 就换成例 3 的图");
    // 一道题两张图：竖着排，都看得见；紧跟标题的「先读题」那段是题面。当前是滚过的最后一张，一圈蓝。
    assert.equal(await page.locator(".lr-fig").count(), 2);
    assert.match(await page.locator(".lr-stem").textContent(), /^先读题/);
    assert.ok(await page.locator(".lr-card-body.is-multi").count(), "几张图时标出当前那张");
    assert.deepEqual(await page.locator(".lr-fig-caption").allTextContents(), ["蒸发器细部"], "没有图注、alt 也是空的那张不留空行");
    await page.screenshot({ path: path.join(out, "three-problem-light.png") });
    await scrollTo(line("例 3 推导 2")); await settle();
    assert.equal(await page.locator(".lr-fig.is-current").getAttribute("data-index"), "2", "两张图都滚过了：当前是第二张");
    await page.evaluate(() => { document.querySelector(".lr-card-body").firstElementChild.dataset.probe = "1"; });
    await scrollTo(line("例 3 推导 5")); await settle();
    assert.equal(await page.locator(".lr-card-body [data-probe]").count(), 1, "同一道题里翻页不重画卡片");
    // 点卡里的第二张图：放大的只是这一张，不是整道题。
    await page.locator(".lr-fig").nth(1).locator("img").click();
    assert.equal(await page.locator(".lr-figure-modal img").count(), 1);
    assert.doesNotMatch(await page.locator(".lr-figure-modal-body").textContent(), /先读题/);
    await page.evaluate(() => document.querySelector(".modal-container").remove());

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
    assert.equal(await page.locator(".lr-card-kind").textContent(), "本题", "取消钉住后回到跟随");

    // 4. 目录跳转走 applyScroll，当前章节马上亮。
    await page.getByRole("button", { name: headings[4] }).click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.applied), line("## 课后总结"));
    assert.equal(await page.locator(".lr-row.is-active .lr-title").textContent(), headings[4]);
    // 手风琴：进了「课后总结」，同级的「课堂记录」自己收起。
    assert.equal(await page.locator(".lr-heading").count(), 2);
    assert.match(await page.locator(".lr-empty").textContent(), /^这一节没有图/);
    assert.equal(await page.locator(".lr-card-context").textContent(), "课后总结", "空着时标题栏也说是哪一节");
    // 手动展开的听手动的；「只展开当前章」一键收回；「全部展开」全开。
    await page.getByRole("button", { name: "展开 课堂记录" }).click();
    assert.equal(await page.locator(".lr-heading").count(), 5);
    await page.getByRole("button", { name: "只展开当前章" }).click();
    assert.equal(await page.locator(".lr-heading").count(), 2);
    await page.getByRole("button", { name: "全部展开" }).click();
    assert.equal(await page.locator(".lr-heading").count(), 5);
    await page.getByRole("button", { name: "只展开当前章" }).click();
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
    await img.hover();
    assert.equal(await page.locator(".lr-pin-float span").textContent(), "钉住本题", "题里的图钉整道题，浮钮上说清楚");
    await page.locator(".lr-pin-float").click();
    assert.match((await pins()).markdown, /^!\[例 2 原题流程图\]\(_assets\/例2-流程图\.svg\)\n\n图中数字是流股编号[^\n]*\n\n\*\*题目\*\*：进料 1/);
    // 实机上这一下曾穿透到图片，打开了 Obsidian 的图片灯箱。
    assert.equal(await page.evaluate(() => window.imgClicks), 0, "按「钉住」不许点到底下的图");
    assert.equal(await page.locator(".lr-card-kind").textContent(), "已钉住 · 题目");
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

    // 8. 栏宽键盘可调；收起后正文仍然限宽居中，左上角留一个打开的按钮。
    // 目录栏的分隔线在它右边：方向键右是变宽。三列时调的是三列的宽，叠在左栏时的宽不动。
    await page.getByRole("separator", { name: "调整目录宽度" }).focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => p.data.noteReading.navWidth), 280);
    assert.equal(await page.evaluate(() => p.data.noteReading.width), 340, "叠在左栏时的宽不动");
    // 题图栏的分隔线在它左边：往左拖是变宽。
    const figBefore = (await page.locator(".lr-side").boundingBox()).width;
    const handle = await page.getByRole("separator", { name: "调整题图宽度" }).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 200);
    await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2 - 60, handle.y + 200, { steps: 4 }); await page.mouse.up();
    const figAfter = (await page.locator(".lr-side").boundingBox()).width;
    assert.ok(Math.abs(figAfter - figBefore - 60) <= 2, `题图栏 ${figBefore} → ${figAfter}`);
    assert.equal(await page.evaluate(() => p.data.noteReading.figWidth), Math.round(figBefore) + 60);
    assert.equal(await page.evaluate(() => p.data.noteReading.figWidthSet), true, "拖过就不再自动");
    // 拖过头也给正文留 560。
    await page.getByRole("separator", { name: "调整题图宽度" }).focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
    const docLeft = await page.locator(".lr-rail").boundingBox(), docRight = await page.locator(".lr-side").boundingBox();
    assert.ok(docRight.x - (docLeft.x + docLeft.width) >= 559, `正文只剩 ${docRight.x - (docLeft.x + docLeft.width)}`);
    await page.evaluate(() => { Object.assign(p.data.noteReading, { navWidth: 260, figWidth: null, figWidthSet: false }); rail.mounts.forEach((m) => rail.applyWidth(m)); });
    // 状态栏浮在栏底上时（Obsidian 就是这样），栏底让出它的高度。
    const foot = await page.evaluate(() => {
      const bar = document.querySelector(".status-bar");
      Object.assign(bar.style, { position: "fixed", right: "0", bottom: "0", width: "100%", height: "30px" });
      rail.mounts.forEach((m) => rail.layout(m));
      const r = document.querySelector(".lr-rail"), outline = document.querySelector(".lr-outline").getBoundingClientRect(), card = document.querySelector(".lr-card").getBoundingClientRect();
      const top = bar.getBoundingClientRect().top;
      bar.removeAttribute("style"); rail.mounts.forEach((m) => rail.layout(m));
      return { outline: outline.bottom, card: card.bottom, bar: top, pad: getComputedStyle(r).paddingBottom };
    });
    assert.ok(foot.card <= foot.bar && foot.outline <= foot.bar, `状态栏压住了栏底：${JSON.stringify(foot)}`);
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
      for (const sel of [".lr-bar-title", ".lr-row.is-top .lr-heading", ".lr-row:not(.is-top):not(.is-active) .lr-heading", ".lr-row.is-active .lr-heading", ".lr-page", ".lr-card-kind", ".lr-card-context", ".lr-card-note", ".lr-fig-caption", ".lr-stem p"]) {
        const node = document.querySelector(sel); if (!node || !node.offsetParent) continue;
        const fg = over(rgb(getComputedStyle(node).color), bgOf(node)), bg = bgOf(node);
        const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
        out[sel] = +((a + 0.05) / (b + 0.05)).toFixed(2);
      }
      return out;
    });
    // 先取消钉住，量的是本题卡（图注、题面）。
    await page.evaluate(() => { delete p.data.noteReading.pins[leaf.view.file.path]; rail.mounts.forEach((m) => { m.cardKey = null; rail.paintCard(m); }); });
    await scrollTo(line("第 3 步")); await settle();
    const light = await measure();
    assert.ok(".lr-fig-caption" in light && ".lr-stem p" in light, `没量到图注和题面：${JSON.stringify(light)}`);
    await page.evaluate(() => document.body.classList.add("theme-dark"));
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, "reading-dark.png") });
    const dark = await measure();
    for (const [theme, values] of [["浅色", light], ["深色", dark]]) {
      assert.ok(Object.keys(values).length >= 5, `${theme}量到的锚点太少：${JSON.stringify(values)}`);
      for (const [sel, ratio] of Object.entries(values)) assert.ok(ratio >= 4.5, `${theme} ${sel} 只有 ${ratio}`);
    }
    await page.evaluate(() => document.body.classList.remove("theme-dark"));

    // 10. 翻页阅读：一屏一页、左右翻。页断在行与行之间，前一页的页底就是后一页的页首，不重不漏。
    await page.evaluate(() => { const sc = document.querySelector(".markdown-preview-view"); sc.scrollTop = 0; });
    await page.getByRole("button", { name: "翻页阅读" }).click();
    assert.equal(await page.evaluate(() => p.data.noteReading.paged), true);
    assert.ok(await page.locator(".view-content").evaluate((e) => e.classList.contains("lr-paged")));
    assert.equal(await page.getByRole("button", { name: "改回上下滚动" }).getAttribute("aria-pressed"), "true");
    await page.waitForTimeout(250);
    // 当前这一页：页首、页底（sizer 坐标），以及页首线、页底线上有没有被切成两半的行。
    const pageState = () => page.evaluate(() => {
      const pager = [...rail.mounts.values()][0].pager, g = pager.geometry();
      const cut = (y) => pagerModule.unitAt(g.sizer, y, window);
      const split = (y) => { const u = pagerModule.unitAt(g.sizer, y, window); return u && u.top < y - 1 && u.bottom > y + 1 ? u : null; };
      const clip = g.sizer.style.clipPath;
      const bar = pager.end + g.sizerTop;
      return {
        start: Math.round(pager.start), end: Math.round(pager.end), scrollTop: g.scroller.scrollTop, clip,
        startAt: Math.round(g.sizerTop + pager.start - g.top), bottomRoom: g.bottom - bar,
        // 滚动位置是整数、断点是小数：离边线不到 1px 的不算切开。
        splitTop: g.scroller.scrollTop > 0 ? split(g.sizerTop + pager.start) : null,
        splitBottom: split(bar),
        scrollbar: getComputedStyle(g.scroller).scrollbarWidth,
      };
    });
    const flip = async (key) => { await page.keyboard.press(key); await page.waitForTimeout(420); return pageState(); };
    const first = await pageState();
    assert.equal(first.scrollTop, 0, "打开翻页时在篇首");
    assert.match(first.clip, /^inset\(/);
    assert.equal(first.scrollbar, "none", "翻页时不显示滚动条");
    const pages = [first];
    for (let i = 0; i < 20; i++) {
      const next = await flip("ArrowRight");
      if (next.start === pages.at(-1).start) break;
      pages.push(next);
    }
    assert.ok(pages.length >= 3, `这篇笔记应当不止两页：${pages.length}`);
    pages.forEach((pg, i) => {
      assert.ok(pg.bottomRoom >= -0.5, `第 ${i + 1} 页的页底越过了页底线：${pg.bottomRoom}`);
      // 页底只在「一行正好落在页底线上」时才用剪；剪的地方不能把一行字切成两半。
      assert.equal(pg.splitBottom, null, `第 ${i + 1} 页页底切在一行中间：${JSON.stringify(pg)}`);
      assert.equal(pg.splitTop, null, `第 ${i + 1} 页页首切在一行中间：${JSON.stringify(pg)}`);
      if (i > 0) {
        assert.equal(pg.start, pages[i - 1].end, `第 ${i} 页的页底应当就是第 ${i + 1} 页的页首`);
        assert.ok(Math.abs(pg.startAt) <= 1, `第 ${i + 1} 页的页首没对上页首线：${pg.startAt}`);
      }
    });
    await page.screenshot({ path: path.join(out, "paged-light.png") });
    // 翻到头再按：不动。
    const last = pages.at(-1);
    assert.equal((await flip("PageDown")).start, last.start, "最后一页再往后翻不动");
    // 往回翻：一页一页原路回去。
    for (let i = pages.length - 2; i >= 0; i--) {
      const back = await flip("ArrowLeft");
      assert.equal(back.start, pages[i].start, `往回翻到第 ${i + 1} 页`);
      assert.equal(back.end, pages[i].end);
      if (i === 1) { await page.mouse.move(800, 500); await page.screenshot({ path: path.join(out, "paged-middle-light.png") }); }
    }
    assert.equal((await flip("ArrowLeft")).scrollTop, 0, "第一页再往前翻不动");
    // 一次滚轮手势只翻一页（触控板惯性是一串小事件）。
    const box = await page.locator(".markdown-preview-view").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 300);
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 25); await page.waitForTimeout(16); }
    await page.waitForTimeout(450);
    assert.equal((await pageState()).start, pages[1].start, "一串滚轮只翻了一页");
    // 触控 / 手写笔往左一划：下一页；划完抬笔不算点击。
    await page.evaluate(({ x, y }) => {
      const sc = document.querySelector(".markdown-preview-sizer p");
      const opt = (cx) => ({ bubbles: true, cancelable: true, composed: true, pointerType: "touch", isPrimary: true, pointerId: 7, clientX: cx, clientY: y });
      sc.dispatchEvent(new PointerEvent("pointerdown", opt(x)));
      sc.dispatchEvent(new PointerEvent("pointerup", opt(x - 160)));
    }, { x: box.x + box.width / 2, y: box.y + 300 });
    await page.waitForTimeout(450);
    assert.equal((await pageState()).start, pages[2].start, "左划翻到下一页");
    // 目录跳转之后从那一节重新分页：标题在页首，往前翻的那一页正好接到它。
    await page.getByRole("button", { name: headings[3] }).click();
    await page.waitForTimeout(450);
    const jumped = await pageState();
    const headingTop = await page.evaluate(() => {
      const pager = [...rail.mounts.values()][0].pager, g = pager.geometry();
      const h = [...document.querySelectorAll(".markdown-preview-sizer h4")].find((e) => e.textContent.startsWith("例 3"));
      return h.getBoundingClientRect().top - (g.sizerTop + pager.start);
    });
    assert.ok(headingTop >= -1 && headingTop < 40, `跳转后「例 3」应当在页首：${headingTop}`);
    assert.ok(Math.abs(jumped.startAt) <= 1, `跳转后页首对齐页首线：${jumped.startAt}`);
    const before = await flip("ArrowLeft");
    assert.equal(before.end, jumped.start, "跳转后往前翻的那一页，页底正好接上跳转的那一页");
    assert.equal(before.splitTop, null, "往前翻出来的页首不切行");
    assert.equal((await flip("ArrowRight")).start, jumped.start, "再往后翻回到跳转的那一页");
    // 实机：翻完之后整篇成了白纸——退场动画的终态（左移、透明）留在了元素上。每翻一次都要回到完全可见。
    const visible = () => page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".markdown-preview-sizer")); return { opacity: cs.opacity, transform: cs.transform, inline: document.querySelector(".markdown-preview-sizer").style.opacity }; });
    assert.deepEqual(await visible(), { opacity: "1", transform: "none", inline: "" }, "翻完页正文完全可见");
    // 连按：翻页进行中再按，不许卡在透明。
    for (let i = 0; i < 6; i++) await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight");
    await page.waitForTimeout(900);
    assert.deepEqual(await visible(), { opacity: "1", transform: "none", inline: "" }, "连按之后正文完全可见");
    // 实机：翻过去之后 Obsidian 重新量了上面的段落，整篇上移 16px，新页顶上露出上一页最后一行的半截。
    // 页首锚在段落上：上面的内容变高、变矮，页首都跟着同一行走，还是对齐页首线、不切行。
    await page.evaluate(() => { document.querySelector(".markdown-preview-view").scrollTop = 0; });
    await page.waitForTimeout(300);
    await flip("ArrowRight"); const shiftedFrom = await flip("ArrowRight");
    const lineAtTop = () => page.evaluate(() => { const pager = [...rail.mounts.values()][0].pager, g = pager.geometry(); const el = document.elementFromPoint(g.sizer.getBoundingClientRect().left + 30, g.sizerTop + pager.start + 12); return el?.closest("[data-line]")?.dataset.line; });
    const topLine = await lineAtTop();
    const sectionY = () => page.evaluate((l) => { const g = [...rail.mounts.values()][0].pager.geometry(); return document.querySelector(`.markdown-preview-sizer [data-line="${l}"]`).getBoundingClientRect().top - g.sizerTop; }, topLine);
    const y0 = await sectionY();
    await page.evaluate(() => { document.querySelector(".markdown-preview-sizer [data-line]").style.paddingTop = "16px"; });
    await page.waitForTimeout(400);
    const shifted = await pageState();
    assert.equal(await lineAtTop(), topLine, "上面变高之后页首还是同一段");
    assert.ok(Math.abs(shifted.startAt) <= 1, `上面变高之后页首还对着页首线：${shifted.startAt}`);
    assert.equal(shifted.splitTop, null, "上面变高之后页首不切行");
    assert.equal(shifted.splitBottom, null, "上面变高之后页底不切行");
    const moved = (await sectionY()) - y0;
    assert.ok(moved > 10 && Math.abs(shifted.start - shiftedFrom.start - moved) <= 1, `页首跟着内容挪了 ${moved}：${shiftedFrom.start} → ${shifted.start}`);
    await page.evaluate(() => { document.querySelector(".markdown-preview-sizer [data-line]").style.paddingTop = ""; });
    await page.waitForTimeout(300);
    // 实机：插件在后台标签页里重载，翻页器量不到尺寸；切回这篇时要自己重新分页，不能停在旧剪裁里。
    const hidden = await page.evaluate(async () => {
      const m = [...rail.mounts.values()][0], sc = document.querySelector(".markdown-preview-view");
      m.pager.set(false);
      document.querySelector(".markdown-reading-view").style.display = "none";
      m.pager.set(true);
      await new Promise((r) => setTimeout(r, 200));
      const before = document.querySelector(".markdown-preview-sizer").style.clipPath;
      sc.scrollTop = 400;
      document.querySelector(".markdown-reading-view").style.display = "";
      await new Promise((r) => setTimeout(r, 500));
      return { before, after: document.querySelector(".markdown-preview-sizer").style.clipPath, start: m.pager.start, top: sc.getBoundingClientRect().top };
    });
    assert.equal(hidden.before, "", "后台时不剪");
    assert.match(hidden.after, /^inset\(/, `切回来之后重新分页：${JSON.stringify(hidden)}`);
    // 实机：Obsidian 列表项里的圆点是一个 flex 的 span.list-bullet，和那一行字并排跨线、里面没有字。
    // 第一稿往圆点里找、找不到就当空白，页底把那一行拦腰切开。
    const bullet = await page.evaluate(() => {
      const li = document.createElement("li");
      li.style.cssText = "width:300px;line-height:28px;font-size:16px";
      const dot = document.createElement("span"); dot.className = "list-bullet"; dot.style.cssText = "display:flex;float:left;height:28px;width:12px";
      li.append(dot, "例 2.6 讲义没解释为什么极限状态是两根缆同时达到 800 N。本文补了这一步，并且复算了一遍。");
      const ul = document.createElement("ul"); ul.append(li);
      document.querySelector(".markdown-preview-sizer").append(ul);
      const r = li.getBoundingClientRect(), y = r.top + 5;
      const u = pagerModule.unitAt(ul, y, window);
      ul.remove();
      return { u, top: r.top };
    });
    assert.ok(bullet.u && bullet.u.top - bullet.top >= 0 && bullet.u.top - bullet.top < 8, `列表第一行应当量得到：${JSON.stringify(bullet)}`);
    // 关掉：剪裁、滚动条、类名都还原。
    await page.getByRole("button", { name: "改回上下滚动" }).click();
    const off = await page.evaluate(() => ({ clip: document.querySelector(".markdown-preview-sizer").style.clipPath, paged: document.querySelector(".view-content").classList.contains("lr-paged"), bar: getComputedStyle(document.querySelector(".markdown-preview-view")).scrollbarWidth }));
    assert.deepEqual(off, { clip: "", paged: false, bar: "auto" });
    assert.equal(await page.evaluate(() => p.data.noteReading.paged), false);

    // 11. 不够三列（笔记这一格 < 1180）：题图卡收进左栏、跟在目录下面。
    await page.setViewportSize({ width: 1100, height: 900 }); await page.waitForTimeout(150);
    assert.ok(!(await page.locator(".view-content").evaluate((e) => e.classList.contains("lr-three"))));
    assert.ok(await page.locator(".lr-side").isHidden());
    const left = await page.evaluate(() => ({ rail: document.querySelector(".lr-rail").getBoundingClientRect().right, doc: document.querySelector(".markdown-preview-view").getBoundingClientRect().left }));
    assert.ok(left.rail <= left.doc + 1, "叠起来时目录栏仍在左边");
    const stack = await page.evaluate(() => ({ outline: document.querySelector(".lr-outline").getBoundingClientRect(), card: document.querySelector(".lr-card").getBoundingClientRect() }));
    assert.ok(stack.card.top >= stack.outline.bottom - 1, "一列时题图在目录下面");
    await page.screenshot({ path: path.join(out, "stack-light.png") });
    // 目录很长时卡不许被挤扁：实机上四十几个标题把题图压成栏底一条只剩标题的缝。
    const squeeze = await page.evaluate(() => {
      const outline = document.querySelector(".lr-outline"), extra = [];
      for (let i = 0; i < 60; i++) { const row = outline.lastElementChild.cloneNode(true); outline.append(row); extra.push(row); }
      const body = document.querySelector(".lr-card-body"), card = document.querySelector(".lr-card"), rail = document.querySelector(".lr-rail");
      const b = body.getBoundingClientRect(), img = document.querySelector(".lr-card-body img").getBoundingClientRect();
      const result = { img: img.height, imgBottom: img.bottom, bodyBottom: b.bottom, cardBottom: card.getBoundingClientRect().bottom, railBottom: rail.getBoundingClientRect().bottom, outline: outline.clientHeight };
      extra.forEach((row) => row.remove());
      return result;
    });
    // 卡里还有题面，放不下就在卡里滚；但图本身要整张看得见。
    assert.ok(squeeze.img > 80 && squeeze.imgBottom <= squeeze.bodyBottom + 1, `目录长时题图被挤扁：${JSON.stringify(squeeze)}`);
    assert.ok(squeeze.cardBottom <= squeeze.railBottom + 1, "卡不许溢出栏底");
    assert.ok(squeeze.outline >= 120, `目录只剩 ${squeeze.outline}px`);

    // 12. 窄窗口：栏收成抽屉，按钮拉出来，Esc 收回；卸载清干净。
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
    console.log("阅读栏：编辑 / 阅读两种模式挂载、三列（目录最左）、本题卡与本节题图、悬停钉住、命令钉块、目录跳转与手风琴、沉浸、两道分隔线、状态栏让位、翻页阅读、一列与抽屉、可读性（浅色 %j，深色 %j）全部通过。", light, dark);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
