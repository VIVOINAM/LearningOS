"use strict";

/**
 * 课堂笔记阅读栏：右边一条安静的目录，底下一张「题图卡」。
 *
 * 7.3 重写。上一稿的三个问题：
 * - 只在阅读模式挂载。可课堂笔记从工作台打开就是编辑模式（上课要能直接打字），
 *   于是每次都要先切到阅读模式才看得见它。现在两种模式都挂，判断全走源码行号（见 reading-rail-model.js）。
 * - 「选取内容 → 再点正文」是一个模式。现在图、公式、表格、callout 悬停时右上角浮出「钉住」，一下就钉。
 * - 一张大玻璃卡里摆两个标题、两段说明、一个空框。现在栏本身没有底，目录是一列字，
 *   卡片只在有东西可看时出现：钉住的内容，或者「这道题的图已经滚出屏幕」时的那张图（题图跟随）。
 *
 * 第二稿（同在 7.3）：目录搬到最左边，宽窗口下是「目录 | 正文 | 题图」三列。目录和题图叠在
 * 右边一栏时，目录一长就把题图挤到栏底，两边都得滚；讲义笔记四十几个标题、一节三四张图，这是常态。
 * - 目录一行一个标题，页码拆成右边的小字，长标题截断、悬停看全；只展开读到的那一章（手风琴）。
 * - 题图列跟着当前小节走：这一节直属的图，没有就用上级的；几张图时底下一排缩略图。
 *   钉住的内容压过跟随，翻到别的节也不动。
 * 笔记这一格不够三列（< 1180）时题图卡收进左栏、跟在目录下面，再窄是抽屉（见 layoutMode）。
 *
 * 沉浸阅读把 Obsidian 的左右栏收起、功能区和状态栏藏掉，标签栏和页头淡到悬停才出现；Esc 退出。
 *
 * 7.4 翻页阅读：阅读模式下一屏一页、左右翻，不再上下滚（见 reading-pager.js）。默认开，目录栏顶上一个开关。
 *
 * 本题卡：习题课翻到第三页的解答时，要对照的是题面和图，不是一张缩略图。读到的地方在一道题里，
 * 卡片就是这道题的题面 + 图（图注、题号点名借来的图都在）；讲授的小节是每张图 + 图注 + 引导它的那段话，
 * 竖着排满这一栏，当前那张一圈蓝。怎么认题、取到哪里为止见 reading-rail-model.js 的 card()。
 */

const { MarkdownView, Modal, Notice, setIcon } = require("obsidian");
const { el, btn } = require("../shared/dom");
const { renderMarkdown, markdownOwner } = require("../l-os-study/core/markdown-render");
const M = require("./reading-rail-model");
const { Pager } = require("./reading-pager");

const PINNABLE = ".callout, table, .math-block, mjx-container[display=\"true\"], img";
const IMMERSIVE = "lr-immersive";

function iconButton(parent, icon, label, action, cls = "") {
  const node = btn(parent, "", action, `lr-icon ${cls}`.trim(), (error) => new Notice(error.message));
  node.setAttribute("aria-label", label);
  setIcon?.(node, icon);
  return node;
}

function relabel(node, icon, label) {
  node.setAttribute("aria-label", label);
  node.replaceChildren();
  setIcon?.(node, icon);
}

/** 从块的源码认出它是什么，给卡片一个说法。 */
function kindOf(markdown) {
  const text = String(markdown || "").trim();
  if (M.imageIn(text) && text.split("\n").length === 1) return "图";
  if (text.startsWith("$$")) return "公式";
  if (text.startsWith("|")) return "表格";
  const callout = /^>\s*\[!\w+\][+-]?\s*(.*)$/m.exec(text);
  if (callout) return callout[1].trim() || "提示";
  if (text.startsWith(">")) return "引用";
  if (text.startsWith("```")) return "代码";
  return "段落";
}

class FigureModal extends Modal {
  constructor(app, shown, path) { super(app); this.shown = shown; this.path = path; }
  onOpen() {
    this.modalEl.classList.add("lr-figure-modal");
    const head = el(this.contentEl, "header", "lr-figure-modal-head");
    const caption = el(head, "div", "lr-figure-modal-caption");
    el(caption, "strong", "", this.shown.title);
    if (this.shown.context) el(caption, "span", "", this.shown.context);
    const toggle = btn(head, "原始尺寸", () => {
      const original = this.contentEl.classList.toggle("is-original");
      toggle.textContent = original ? "适应窗口" : "原始尺寸";
    }, "lr-pill");
    this.owner = markdownOwner();
    const body = el(this.contentEl, "div", "lr-figure-modal-body");
    renderMarkdown(this.app, this.owner, body, this.shown.markdown, this.path);
  }
  onClose() { this.owner?.unload(); this.contentEl.replaceChildren(); }
}

class ReadingRail {
  constructor(plugin) {
    this.p = plugin;
    this.app = plugin.app;
    this.mounts = new Map();
    this.sections = new WeakMap();
    this.timer = null;
    this.disposed = false;
    this.immersive = false;
    this.restore = null;
  }

  start() {
    const p = this.p, ws = this.app.workspace;
    for (const event of ["layout-change", "active-leaf-change", "file-open"]) p.registerEvent(ws.on(event, () => this.schedule()));
    p.registerEvent(ws.on("editor-change", (editor, info) => {
      const m = [...this.mounts.values()].find((mount) => mount.leaf.view === info || mount.leaf.view?.editor === editor);
      if (m) this.rescanSoon(m);
    }));
    p.registerEvent(this.app.metadataCache.on("changed", (file) => {
      for (const m of this.mounts.values()) if (m.path === file.path) this.rescanSoon(m);
    }));
    p.registerEvent(this.app.vault.on("rename", (file, old) => {
      const pins = this.settings().pins;
      if (pins?.[old]) { pins[file.path] = pins[old]; delete pins[old]; this.save(); }
      this.schedule();
    }));
    p.registerEvent(this.app.vault.on("delete", (file) => {
      const pins = this.settings().pins;
      if (pins?.[file.path]) { delete pins[file.path]; this.save(); }
      this.schedule();
    }));
    // 阅读模式下「点中的东西在第几行」只能靠渲染时留下的 section 信息。
    p.registerMarkdownPostProcessor((root, ctx) => {
      if (!ctx.sourcePath?.includes("/课堂笔记/") || root.closest?.(".lr-rail,.lr-side,.lr-figure-modal")) return;
      this.sections.set(root, ctx);
    });
    p.registerEvent(ws.on("editor-menu", (menu, editor, info) => {
      const m = this.mountOf(info?.leaf) || [...this.mounts.values()].find((mount) => mount.leaf.view === info);
      if (!m) return;
      menu.addItem((item) => item.setTitle("钉到阅读栏").setIcon("pin").onClick(() => this.pinSelection(m)));
    }));
    const active = () => {
      const view = MarkdownView && ws.getActiveViewOfType?.(MarkdownView);
      return [...this.mounts.values()].find((m) => m.leaf.view === view) || this.mountOf(ws.activeLeaf);
    };
    const command = (id, name, run) => p.addCommand({ id, name, checkCallback: (checking) => {
      const m = active();
      if (!m) return false;
      if (!checking) Promise.resolve(run(m)).catch((error) => new Notice(error.message));
      return true;
    } });
    command("reading-pin", "课堂笔记：把选中内容钉到阅读栏", (m) => this.pinSelection(m));
    command("reading-immersive", "课堂笔记：沉浸阅读（开 / 关）", () => this.setImmersive(!this.immersive));
    command("reading-paged", "课堂笔记：翻页阅读（开 / 关）", (m) => this.togglePaged(m));
    command("reading-rail", "课堂笔记：显示 / 收起阅读栏", (m) => this.setCollapsed(m, !this.hidden(m)));
    command("reading-follow", "课堂笔记：题图跟随（开 / 关）", () => {
      const s = this.settings();
      s.follow = s.follow === false;
      for (const m of this.mounts.values()) { m.cardKey = null; this.update(m); }
      new Notice(s.follow ? "题图跟随已打开：阅读栏跟着显示当前小节的图。" : "题图跟随已关闭：阅读栏只显示你钉住的内容。");
      return this.save();
    });
    // Esc：Obsidian 的全局按键处理注册得比插件早，在捕获阶段就把 Esc 截走了——
    // 第一版挂在 document 上，实机上一次都没收到。所以走 Obsidian 自己的按键作用域；
    // 窗口上的监听留作后备（没有 app.scope 的环境，比如视觉夹具）。
    // 有弹窗、菜单、补全框开着时让路，这一下 Esc 是关它们的。
    const escape = () => {
      if (document.querySelector(".modal-container, .menu, .suggestion-container, .prompt")) return false;
      for (const m of this.mounts.values()) if (m.compact && m.drawer) { m.drawer = false; this.layout(m); return true; }
      if (!this.immersive) return false;
      this.setImmersive(false);
      return true;
    };
    const scoped = this.app.scope?.register?.([], "Escape", () => (escape() ? false : undefined));
    if (scoped) p.register(() => this.app.scope.unregister(scoped));
    const keydown = (event) => { if (event.key === "Escape") escape(); };
    window.addEventListener("keydown", keydown, true);
    p.register(() => window.removeEventListener("keydown", keydown, true));
    ws.onLayoutReady(() => this.sync());
    p.register(() => this.dispose());
  }

  /**
   * width 是目录和题图叠在左栏时的栏宽；navWidth、figWidth 是三列时左边目录和右边题图各自的宽。
   * figWidth 为 null 是「自动」（见 M.figWidth），拖过才存数。380 是旧版写进去的缺省值，
   * 没拖过的人存的都是它，一次性改回自动（figWidthSet 标记拖过）。
   */
  settings() {
    const s = (this.p.data.noteReading ||= {});
    s.pins ||= {};
    if (s.width == null) s.width = 340;
    if (s.navWidth == null) s.navWidth = 260;
    if (s.figWidth === 380 && !s.figWidthSet) s.figWidth = null;
    return s;
  }
  save() { return this.p.save().catch((error) => new Notice("阅读栏设置保存失败：" + error.message)); }
  schedule() { if (this.disposed) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 90); }
  mountOf(leaf) { return leaf ? this.mounts.get(leaf) : null; }

  sync() {
    if (this.disposed) return;
    const valid = new Set();
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view, host = view?.contentEl, mode = view?.getMode?.();
      if (!host || !M.eligible(view.file) || !["source", "preview"].includes(mode)) continue;
      valid.add(leaf);
      let m = this.mounts.get(leaf);
      if (m && (m.path !== view.file.path || m.host !== host)) { this.unmount(m); m = null; }
      if (!m) { m = this.mount(leaf, host); this.mounts.set(leaf, m); }
      if (m.mode !== mode) { m.mode = mode; this.hideFloat(m); this.rescan(m); this.page(m); }
    }
    for (const [leaf, m] of this.mounts) if (!valid.has(leaf)) { this.unmount(m); this.mounts.delete(leaf); }
    // 沉浸只属于课堂笔记：切到别的页就退出，免得把整个 Obsidian 留在一个藏了功能区的状态里。
    if (this.immersive && !this.mountOf(this.app.workspace.activeLeaf)) this.setImmersive(false);
  }

  mount(leaf, host) {
    const view = leaf.view;
    const m = { leaf, host, path: view.file.path, mode: view.getMode(), overrides: new Map(), expandAll: false, cleanups: [], closed: false, top: 0, active: null, activeIndex: -1 };
    host.classList.add("lr-host");
    host.closest(".workspace-leaf")?.classList.add("lr-leaf");
    const listen = (target, name, fn, opts) => { target.addEventListener(name, fn, opts); m.cleanups.push(() => target.removeEventListener(name, fn, opts)); };
    const separator = (parent, cls, label) => {
      const node = el(parent, "div", cls);
      node.tabIndex = 0;
      node.setAttribute("role", "separator");
      node.setAttribute("aria-label", label);
      node.setAttribute("aria-orientation", "vertical");
      return node;
    };

    // 左栏：目录（窄一些时题图卡也在这里，跟在目录下面）。右栏：三列时的题图。卡片按摆法在两栏之间搬。
    const rail = m.rail = el(host, "aside", "lr-rail");
    rail.setAttribute("aria-label", "课堂笔记目录");
    const resize = m.resizer = separator(rail, "lr-resizer", "调整目录宽度");
    const side = m.side = el(host, "aside", "lr-side");
    side.setAttribute("aria-label", "本节题图");
    const sideResize = m.sideResizer = separator(side, "lr-resizer", "调整题图宽度");

    const toc = el(rail, "div", "lr-toc");
    const bar = el(toc, "header", "lr-bar");
    el(bar, "span", "lr-bar-title", "目录");
    const tools = el(bar, "div", "lr-bar-tools");
    m.foldAllButton = iconButton(tools, "chevrons-up-down", "全部展开", () => {
      if (m.expandAll || m.overrides.size) { m.expandAll = false; m.overrides.clear(); }
      else m.expandAll = true;
      m.foldKey = null;
      this.paintActive(m, m.activeIndex);
    });
    m.pageButton = iconButton(tools, "book-open", "翻页阅读", () => this.togglePaged(m));
    m.immersiveButton = iconButton(tools, "maximize-2", "沉浸阅读", () => this.setImmersive(!this.immersive));
    iconButton(tools, "panel-left-close", "收起阅读栏", () => this.setCollapsed(m, true));
    this.paintImmersive(m);
    this.paintPaged(m);

    m.outline = el(toc, "nav", "lr-outline");
    m.outline.setAttribute("aria-label", "本篇目录");

    const card = m.card = el(rail, "section", "lr-card");
    card.hidden = true;
    card.setAttribute("aria-label", "本节题图");
    const head = el(card, "header", "lr-card-head");
    const caption = el(head, "div", "lr-card-caption");
    m.cardKind = el(caption, "span", "lr-card-kind");
    m.cardContext = el(caption, "span", "lr-card-context");
    const cardTools = m.cardTools = el(head, "div", "lr-card-tools");
    m.pinButton = iconButton(cardTools, "pin", "钉住", () => this.togglePin(m));
    iconButton(cardTools, "maximize", "放大查看", () => m.shown && new FigureModal(this.app, this.zoomed(m), m.path).open());
    iconButton(cardTools, "locate", "回到原文", () => m.shown && this.jump(m, m.shown.line));
    m.cardBody = el(card, "div", "lr-card-body");
    // 点卡里的哪张图就放大哪张（连同它的图注和引导语）。
    listen(m.cardBody, "click", (event) => {
      if (!event.target.closest?.("img") || !m.shown) return;
      const item = m.shown.items?.[Number(event.target.closest(".lr-fig")?.dataset.index)];
      new FigureModal(this.app, item ? { ...m.shown, markdown: M.itemMarkdown(item) } : m.shown, m.path).open();
    });
    m.cardNote = el(card, "p", "lr-card-note");
    m.empty = el(card, "p", "lr-empty");
    m.hint = el(rail, "p", "lr-hint", "图、公式、表格悬停时右上角有「钉住」，钉住的会一直留在这里。");

    m.reopen = iconButton(host, "panel-left-open", "显示阅读栏", () => this.setCollapsed(m, false), "lr-reopen");
    m.float = el(host, "button", "lr-pin-float");
    m.float.type = "button";
    setIcon?.(m.float, "pin");
    el(m.float, "span", "", "钉住");
    m.float.hidden = true;

    // 两种模式的滚动容器不同（.markdown-preview-view / .cm-scroller），在宿主上捕获就不用分。
    listen(host, "scroll", (event) => {
      if (event.target?.closest?.(".lr-rail, .lr-side")) return;
      this.hideFloat(m);
      if (!m.frame) m.frame = host.ownerDocument.defaultView.requestAnimationFrame(() => { m.frame = 0; this.update(m); });
    }, { capture: true, passive: true });
    listen(host, "pointerover", (event) => this.hover(m, event));
    listen(host, "pointerleave", () => this.hideFloatSoon(m));
    listen(m.float, "pointerenter", () => clearTimeout(m.floatTimer));
    // 「钉住」按下就算，而且按坐标判断，不看命中的是谁。实机上鼠标明明停在浮钮上，
    // 按下那一刻命中的却是底下的图片或表格单元格——点进表格，Obsidian 会把整张表
    // 按列宽补齐空格重写一遍，笔记就这样被改了。在宿主的捕获阶段截住，编辑器收不到这次按下。
    const pin = () => this.pinTarget(m, m.floatHit)?.catch?.((error) => new Notice(error.message));
    listen(host, "pointerdown", (event) => {
      if (m.float.hidden || event.button !== 0) return;
      const r = m.float.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      m.swallow = Date.now();
      try { pin(); } catch (error) { new Notice(error.message); }
    }, { capture: true });
    // 这次按下之后的 click 也不许落到底下：阅读模式里它会打开 Obsidian 的图片灯箱。
    for (const name of ["mousedown", "mouseup", "click"]) listen(host, name, (event) => {
      if (!m.swallow || Date.now() - m.swallow > 800) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (name === "click") m.swallow = 0;
    }, { capture: true });
    for (const name of ["mousedown", "mouseup", "click"]) listen(m.float, name, (event) => {
      event.stopPropagation();
      // 键盘（Tab 到按钮再按回车 / 空格）只有 click，没有 pointerdown。
      if (name === "click" && event.detail === 0) { try { pin(); } catch (error) { new Notice(error.message); } }
    });
    listen(m.float, "pointerleave", () => this.hideFloatSoon(m));

    const win = host.ownerDocument.defaultView;
    const size = () => {
      const mode = m.layoutMode = M.layoutMode(host.clientWidth);
      m.compact = mode === "compact";
      if (m.three !== (mode === "three")) {
        m.three = mode === "three";
        // 三列时卡在右栏；否则回到左栏、目录下面、提示上面。
        if (m.three) side.append(card); else rail.insertBefore(card, m.hint);
        m.cardKey = null;
        if (m.doc) this.paintCard(m);
      }
      this.layout(m);
    };
    if (win.ResizeObserver) { m.resizeObserver = new win.ResizeObserver(size); m.resizeObserver.observe(host); }
    size();

    // 两道分隔线同一套拖法：按下记起点，拖动时算新宽度，松手才存。触控笔降级成 touch，所以 CSS 里关了平移判定。
    const drag = (handle, begin, move) => {
      let from = null;
      listen(handle, "pointerdown", (event) => {
        if (m.layoutMode === "compact" || event.button !== 0) return;
        from = { x: event.clientX, value: begin() };
        handle.setPointerCapture?.(event.pointerId); event.preventDefault();
      });
      listen(handle, "pointermove", (event) => { if (from) move(from.value, event.clientX - from.x); });
      const stop = () => { if (from) { from = null; this.save(); } };
      for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) listen(handle, name, stop);
      listen(handle, "keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        move(begin(), event.key === "ArrowLeft" ? -20 : 20);
        this.save();
      });
    };
    // 左栏的分隔线在它右边：往右拖是变宽。右栏的在它左边：往左拖是变宽。
    drag(resize, () => rail.getBoundingClientRect().width, (start, dx) => {
      const s = this.settings();
      if (m.three) s.navWidth = M.navWidth(start + dx);
      else s.width = M.railWidth(start + dx);
      this.applyWidth(m);
    });
    drag(sideResize, () => side.getBoundingClientRect().width, (start, dx) => {
      const s = this.settings();
      s.figWidth = M.figWidth(start - dx, host.clientWidth, M.navWidth(s.navWidth));
      s.figWidthSet = true;
      this.applyWidth(m);
    });

    m.pager = new Pager(host, { active: () => this.app.workspace.activeLeaf === leaf, renderer: () => leaf.view.previewMode?.renderer });
    this.page(m);
    this.rescan(m);
    return m;
  }

  // ---- 源码与位置 --------------------------------------------------------

  text(m) {
    const view = m.leaf.view;
    try { return view.getViewData?.() ?? view.data ?? ""; } catch { return view.data || ""; }
  }
  rescanSoon(m) { clearTimeout(m.scanTimer); m.scanTimer = setTimeout(() => this.rescan(m), 250); }
  rescan(m) {
    if (m.closed) return;
    m.doc = M.scan(this.text(m));
    const key = JSON.stringify(m.doc.headings.map((h) => [h.heading, h.level, h.line]));
    // 标题变了，手动折叠记的下标就对不上了，一并清掉。
    if (key !== m.outlineKey) { m.outlineKey = key; m.overrides.clear(); m.foldKey = null; }
    m.cardKey = null;
    this.update(m);
  }
  /** 屏幕顶上是源码第几行。两种模式的 getScroll() 都按行计。 */
  topLine(m) {
    try {
      const value = Number(m.leaf.view.currentMode?.getScroll?.());
      if (Number.isFinite(value)) return value;
    } catch { /* 视图正在切换 */ }
    return m.top || 0;
  }
  /** 点中的元素在源码第几行。编辑模式问 CodeMirror，阅读模式问渲染时留下的 section。 */
  lineOf(m, target) {
    try { return this.lineOfUnsafe(m, target); } catch { return null; }
  }
  lineOfUnsafe(m, target) {
    const view = m.leaf.view;
    if (m.mode === "source") {
      const cm = view.editor?.cm;
      if (cm?.posAtDOM) return cm.state.doc.lineAt(cm.posAtDOM(target)).number - 1;
    }
    for (let node = target; node && node !== m.host; node = node.parentElement) {
      const ctx = this.sections.get(node);
      const info = ctx?.getSectionInfo?.(node);
      if (info) return info.lineStart;
    }
    return null;
  }

  update(m) {
    if (m.closed || !m.doc) return;
    m.top = this.topLine(m);
    // 点目录跳过去之后，高亮留在点的那一行，直到真的滚动了。篇末的标题滚不到屏幕顶上，
    // 按行号算会亮成上一节——点了「课后总结」亮的却是「例 3」。
    const jumped = m.jumped;
    if (jumped && jumped.top == null) jumped.top = m.top;
    else if (jumped && Math.abs(m.top - jumped.top) > 0.5) m.jumped = null;
    this.paintActive(m, m.jumped ? m.jumped.index : M.activeIndex(m.doc.headings, m.top));
    this.paintCard(m);
  }

  // ---- 目录 --------------------------------------------------------------

  /** 一行：[折叠箭头] [标题，截断] [页码]。叶子行的箭头位置留空，同级的字才对得齐。 */
  drawOutline(m, folded) {
    const { rows } = M.outlineRows(m.doc.headings, folded);
    const keepScroll = m.outline.scrollTop;
    m.outline.replaceChildren();
    m.rows = [];
    for (const row of rows) {
      const line = el(m.outline, "div", "lr-row");
      line.style.setProperty("--lr-depth", String(row.depth));
      line.dataset.index = String(row.index);
      line.classList.toggle("is-top", row.depth === 0);
      if (row.parent) {
        const fold = iconButton(line, "chevron-down", (row.folded ? "展开 " : "折叠 ") + row.heading, () => {
          m.overrides.set(row.index, !row.folded);
          m.foldKey = null;
          this.paintActive(m, m.activeIndex);
        }, "lr-fold");
        fold.setAttribute("aria-expanded", String(!row.folded));
        line.classList.toggle("is-folded", row.folded);
      } else el(line, "span", "lr-fold-slot");
      const { title, page } = M.pageOf(row.heading);
      const link = btn(line, "", () => this.jump(m, row.line, row.index), "lr-heading");
      link.title = row.heading;
      el(link, "span", "lr-title", title);
      if (page) el(link, "span", "lr-page", page);
      link.dataset.index = String(row.index);
      m.rows.push(line);
    }
    if (!rows.length) el(m.outline, "p", "lr-hint", "正文里的标题会列在这里。");
    m.outline.scrollTop = keepScroll;
    m.active = null;
  }
  paintFoldAll(m) {
    const auto = !m.expandAll && !m.overrides.size;
    relabel(m.foldAllButton, auto ? "chevrons-up-down" : "chevrons-down-up", auto ? "全部展开" : "只展开当前章");
  }
  /**
   * 当前章节高亮在目录里「看得见的那一行」：它被折起来了，就亮它的上级。
   * 读到别的章时手风琴跟着换：先按新位置重算哪些折起，变了才重画。
   */
  paintActive(m, index) {
    m.activeIndex = index;
    if (!m.doc) return;
    const folded = M.foldedSet(m.doc.headings, index, m.overrides, m.expandAll);
    const foldKey = [...folded].join(",");
    if (foldKey !== m.foldKey) { m.foldKey = foldKey; this.drawOutline(m, folded); this.paintFoldAll(m); }
    const visible = (m.rows || []).filter((row) => Number(row.dataset.index) <= index).at(-1) || null;
    if (visible === m.active) return;
    m.active = visible;
    for (const row of m.rows || []) {
      const on = row === visible;
      row.classList.toggle("is-active", on);
      row.querySelector(".lr-heading")?.setAttribute("aria-current", on ? "location" : "false");
    }
    if (visible && !m.compact) {
      const box = m.outline.getBoundingClientRect(), r = visible.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) m.outline.scrollTop += r.top - box.top - box.height / 3;
    }
  }
  jump(m, line, index = null) {
    const mode = m.leaf.view.currentMode;
    m.pager.releaseForJump(() => [...m.host.querySelectorAll(".markdown-preview-sizer :is(h1,h2,h3,h4,h5,h6)")]
      .find(node => this.lineOf(m, node) === line));
    m.jumped = index == null ? null : { index, top: null };
    if (index != null) this.paintActive(m, index);
    if (mode?.applyScroll) mode.applyScroll(line);
    else m.leaf.view.setEphemeralState?.({ line });
    m.top = line;
    if (m.compact && m.drawer) { m.drawer = false; this.layout(m); }
    setTimeout(() => this.update(m), 60);
  }

  // ---- 题图卡 ------------------------------------------------------------

  /**
   * 钉住的优先；没有钉住的，就是本题卡（读到的地方在一道题里）或这一节的图（题图跟随）。
   * key 只认「哪张卡、卡里有什么」：同一张卡里滚动只挪当前那张的高亮，不重画。
   */
  shown(m) {
    const pin = this.settings().pins[m.path];
    if (pin) return { kind: "pin", key: `pin\n${pin.line}\n${pin.markdown}`, title: `已钉住 · ${pin.label}`, markdown: pin.markdown, label: pin.label, context: M.pageOf(pin.context || "").title, line: pin.line, alt: this.altOf(pin.markdown) };
    if (this.settings().follow === false) return null;
    const card = M.card(m.doc, m.activeIndex, m.top);
    if (!card) return null;
    const problem = card.kind === "problem", current = card.items[card.current];
    return {
      kind: "follow", problem, key: `follow\n${card.index}\n${card.markdown}`,
      title: problem ? "本题" : "本节题图", markdown: card.markdown, items: card.items, current: card.current,
      context: M.pageOf(card.heading).title, line: card.line,
      // 钉住：一道题钉整道题；讲授小节钉当前那张图（连同图注和引导语）。
      pin: problem ? { markdown: card.markdown, label: "题目", line: card.line }
        : { markdown: M.itemMarkdown(current || card.items[0]), label: "图", line: (current || card.items[0]).line },
    };
  }
  /** 放大查看：一道题放大整道题；讲授小节放大当前那张图。 */
  zoomed(m) {
    const shown = m.shown;
    return shown.kind === "follow" && !shown.problem ? { ...shown, markdown: shown.pin.markdown } : shown;
  }
  altOf(markdown) {
    const text = String(markdown || "").trim();
    return !text.includes("\n") && M.imageIn(text)?.alt || "";
  }
  paintCard(m) {
    const shown = this.shown(m);
    const key = shown ? shown.key : `\n${m.three}`;
    this.paintEmptyContext(m, shown);
    m.shown = shown;
    if (key === m.cardKey) { this.paintCurrent(m, shown); return; }
    m.cardKey = key;
    m.currentKey = null;
    m.itemNodes = [];
    m.owner?.unload(); m.owner = null;
    // 三列时右边题图这一列一直在，没有图就说一句——收起会让正文忽宽忽窄、整篇重排。
    // 叠在左栏时卡片只在有东西可看时出现，免得把目录推来推去。
    m.card.hidden = !shown && !m.three;
    m.card.classList.toggle("is-empty", !shown);
    m.cardTools.hidden = !shown;
    m.empty.hidden = !!shown;
    // 提示只教一次：钉过一次之后就不再占地方。
    m.hint.hidden = !!shown || m.three || !!this.settings().pinnedOnce;
    m.cardBody.classList.remove("is-cards", "is-multi", "is-figure");
    if (!shown) {
      m.cardBody.replaceChildren();
      m.cardBody.hidden = true;
      m.cardNote.hidden = true;
      m.cardKind.textContent = "本节题图";
      m.empty.textContent = this.settings().follow === false
        ? "题图跟随已关闭。图、公式、表格悬停时点「钉住」，会固定在这里。"
        : "这一节没有图。" + (this.settings().pinnedOnce ? "" : "图、公式、表格悬停时点「钉住」，可以固定在这里对照着读。");
      return;
    }
    m.cardBody.hidden = false;
    m.card.classList.toggle("is-pinned", shown.kind === "pin");
    m.cardKind.textContent = shown.title;
    m.cardContext.textContent = shown.context;
    m.cardContext.hidden = !shown.context;
    m.cardNote.textContent = shown.alt || "";
    m.cardNote.hidden = !shown.alt;
    relabel(m.pinButton, shown.kind === "pin" ? "pin-off" : "pin", shown.kind === "pin" ? "取消钉住" : shown.problem ? "钉住这道题" : "钉住这张图");
    m.owner = markdownOwner();
    if (shown.items) this.paintItems(m, shown);
    else {
      m.cardBody.classList.toggle("is-figure", !!this.isImage(shown.markdown));
      renderMarkdown(this.app, m.owner, m.cardBody, shown.markdown, m.path);
    }
    m.cardBody.scrollTop = 0;
    this.paintCurrent(m, shown);
    // 换内容时淡入一下：跟随的卡会随翻页换掉，硬切会让人以为栏在闪。
    for (const node of [m.cardBody, m.cardNote]) {
      node.classList.remove("is-entering");
      void node.offsetWidth;
      node.classList.add("is-entering");
    }
  }
  isImage(markdown) { const text = String(markdown || "").trim(); return !text.includes("\n") && M.imageIn(text); }
  /** 卡里一项一块：题面段落，或者「图 + 图注 + 引导语」。图撑满栏宽，从上往下排。 */
  paintItems(m, shown) {
    const body = m.cardBody;
    body.replaceChildren();
    body.classList.add("is-cards");
    body.classList.toggle("is-multi", shown.items.filter((item) => item.kind === "figure").length > 1);
    const render = (parent, tag, cls, markdown) => renderMarkdown(this.app, m.owner, el(parent, tag, cls), markdown, m.path);
    m.itemNodes = shown.items.map((item, index) => {
      if (item.kind === "text") { const node = el(body, "div", "lr-stem"); renderMarkdown(this.app, m.owner, node, item.markdown, m.path); return node; }
      const node = el(body, "figure", "lr-fig");
      node.dataset.index = String(index);
      render(node, "div", "lr-fig-image", item.markdown);
      if (item.caption) render(node, "figcaption", "lr-fig-caption", item.caption);
      else if (item.alt) el(node, "figcaption", "lr-fig-caption", item.alt);
      if (item.lead) render(node, "div", "lr-fig-text", item.lead);
      return node;
    });
  }
  /** 几张图时，滚过的最后一张一圈蓝；换了当前那张，就把它挪到卡顶。 */
  paintCurrent(m, shown) {
    const nodes = m.itemNodes || [];
    const multi = !!shown?.items && m.cardBody.classList.contains("is-multi");
    nodes.forEach((node, index) => node.classList.toggle("is-current", multi && index === shown.current));
    const key = multi ? `${m.cardKey}\n${shown.current}` : null;
    if (!key || key === m.currentKey) return;
    const first = m.currentKey == null;
    m.currentKey = key;
    const node = nodes[shown.current];
    // 刚换卡时当前是第一张就不动：题面在它上面，要先看得见。
    if (node && !(first && shown.items.slice(0, shown.current).every((item) => item.kind === "text"))) {
      m.cardBody.scrollTo?.({ top: Math.max(0, node.offsetTop - 4), behavior: first ? "auto" : "smooth" });
    }
  }
  /** 空着的时候标题栏也要说清是哪一节没有图，所以它跟着当前章节换，不等内容变。 */
  paintEmptyContext(m, shown) {
    if (shown) return;
    const heading = m.doc?.headings[m.activeIndex]?.heading;
    const context = heading ? M.pageOf(heading).title : "";
    if (m.cardContext.textContent !== context) m.cardContext.textContent = context;
    m.cardContext.hidden = !context;
  }
  togglePin(m) {
    const pins = this.settings().pins;
    if (pins[m.path]) delete pins[m.path];
    else if (m.shown) {
      const pin = m.shown.pin || { markdown: m.shown.markdown, label: kindOf(m.shown.markdown), line: m.shown.line };
      pins[m.path] = { ...M.pinValue(pin.markdown, pin.label, pin.line), context: m.shown.context };
    }
    m.cardKey = null;
    this.paintCard(m);
    return this.save();
  }
  setPin(m, markdown, line, label = kindOf(markdown)) {
    const context = m.doc.headings.filter((h) => h.line <= line).at(-1)?.heading || "";
    this.settings().pins[m.path] = { ...M.pinValue(markdown, label, line), context };
    this.settings().pinnedOnce = true;
    this.setCollapsed(m, false, false);
    if (m.compact) { m.drawer = true; this.layout(m); }
    m.cardKey = null;
    this.paintCard(m);
    return this.save();
  }

  // ---- 钉住 --------------------------------------------------------------

  hover(m, event) {
    if (event.target === m.float || m.float.contains(event.target) || event.target.closest?.(".lr-rail, .lr-side")) return;
    const target = event.target.closest?.(PINNABLE);
    const scroller = target?.closest?.(".markdown-preview-view, .cm-scroller");
    if (!target || !scroller || !m.host.contains(scroller) || target.closest(".lr-rail, .lr-side")) { this.hideFloatSoon(m); return; }
    // 行内公式、表情大小的小图不给钉：按钮会比它本身还大。
    const r = target.getBoundingClientRect();
    if (r.width < 80 || r.height < 28) { this.hideFloatSoon(m); return; }
    clearTimeout(m.floatTimer);
    if (m.floatTarget === target && !m.float.hidden) return;
    m.floatTarget = target;
    // 行号在悬停时就量好。点下去的那一刻编辑器可能已经重建了这块的 DOM，到那时再量，元素已经不在文档里了。
    m.floatHit = { line: this.lineOf(m, target), image: target.matches("img") ? target.closest(".internal-embed")?.getAttribute("src") || target.getAttribute("src") || "" : null };
    // 题里的图钉整道题（题面 + 图），浮钮上说清楚。
    m.floatHit.problem = m.floatHit.image != null && m.floatHit.line != null && m.doc ? M.problemAt(m.doc, m.floatHit.line) : null;
    m.float.lastElementChild.textContent = m.floatHit.problem ? "钉住本题" : "钉住";
    const host = m.host.getBoundingClientRect(), view = scroller.getBoundingClientRect();
    const top = Math.max(r.top, view.top) + 8 - host.top;
    m.float.style.top = `${Math.round(top)}px`;
    m.float.style.left = `${Math.round(Math.min(r.right, view.right - 16) - host.left - 8)}px`;
    m.float.hidden = false;
  }
  hideFloatSoon(m) { clearTimeout(m.floatTimer); m.floatTimer = setTimeout(() => this.hideFloat(m), 220); }
  hideFloat(m) { clearTimeout(m.floatTimer); if (m.float) m.float.hidden = true; m.floatTarget = null; m.floatHit = null; }

  pinTarget(m, hit) {
    if (!hit) return;
    this.hideFloat(m);
    if (hit.line == null) throw Error("没找到它在原文里的位置，换成选中文字再钉。");
    if (hit.problem) return this.setPin(m, hit.problem.markdown, hit.problem.line, "题目");
    const block = M.blockAt(this.text(m), hit.line);
    if (!block) throw Error("这里没有可以钉住的内容。");
    let markdown = block.markdown;
    // 图单独钉：它所在的那一段可能还跟着一句说明，栏里只要图。
    if (hit.image != null) {
      let src = hit.image;
      try { src = decodeURIComponent(src); } catch { /* 文件名里本来就有 % */ }
      const images = block.markdown.split("\n").map(M.imageIn).filter(Boolean);
      const found = images.find((image) => src && (src.endsWith(image.link) || image.link.endsWith(src.split("/").pop()))) || images[0];
      if (found) markdown = found.markdown;
    }
    return this.setPin(m, markdown, block.start);
  }
  /** 命令和右键菜单：编辑模式取选区（没有选区取光标所在的块），阅读模式取选中文字所在的几段源码。 */
  pinSelection(m) {
    const view = m.leaf.view, text = this.text(m);
    if (m.mode === "source" && view.editor) {
      const editor = view.editor, selected = editor.getSelection();
      const from = editor.getCursor("from").line;
      if (selected.trim()) return this.setPin(m, selected, from);
      const block = M.blockAt(text, editor.getCursor().line);
      if (!block) throw Error("光标所在的地方没有内容。");
      return this.setPin(m, block.markdown, block.start);
    }
    const selection = m.host.ownerDocument.getSelection();
    if (!selection || selection.isCollapsed) throw Error("先选中要钉住的文字，或者把鼠标移到图和公式上点「钉住」。");
    const lines = [selection.anchorNode, selection.focusNode].map((node) => this.lineOf(m, node?.nodeType === 1 ? node : node?.parentElement)).filter((n) => n != null);
    if (lines.length === 2) {
      const a = M.blockAt(text, Math.min(...lines)), b = M.blockAt(text, Math.max(...lines));
      if (a && b) return this.setPin(m, text.split(/\r?\n/).slice(a.start, b.end + 1).join("\n"), a.start);
    }
    return this.setPin(m, selection.toString(), lines[0] || 0);
  }

  // ---- 布局与沉浸 --------------------------------------------------------

  hidden(m) { return m.compact ? !m.drawer : !!this.settings().collapsed; }
  setCollapsed(m, collapsed, persist = true) {
    if (m.compact) { m.drawer = !collapsed; this.layout(m); return; }
    this.settings().collapsed = collapsed;
    for (const mount of this.mounts.values()) this.layout(mount);
    if (persist) return this.save();
  }
  layout(m) {
    const hidden = this.hidden(m);
    m.host.classList.toggle("lr-compact", !!m.compact);
    m.host.classList.toggle("lr-three", !!m.three);
    m.host.classList.toggle("lr-collapsed", hidden);
    m.reopen.hidden = !hidden;
    if (hidden) this.hideFloat(m);
    this.applyWidth(m);
    this.clearFooter(m);
  }
  /** 栏宽写成 CSS 变量：叠在左栏时一个宽，三列时左右各一个。 */
  applyWidth(m) {
    const s = this.settings(), host = m.host;
    const aria = (node, min, max, now) => {
      node.setAttribute("aria-valuemin", String(min));
      node.setAttribute("aria-valuemax", String(max));
      node.setAttribute("aria-valuenow", String(now));
    };
    if (!m.three) {
      const width = M.railWidth(s.width);
      host.style.setProperty("--lr-width", width + "px");
      aria(m.resizer, 260, 560, width);
      return;
    }
    const nav = M.navWidth(s.navWidth), fig = M.figWidth(s.figWidth, host.clientWidth, nav);
    host.style.setProperty("--lr-nav", nav + "px");
    host.style.setProperty("--lr-fig", fig + "px");
    aria(m.resizer, 200, 420, nav);
    aria(m.sideResizer, 300, M.figWidth(Infinity, host.clientWidth, nav), fig);
  }
  /**
   * Obsidian 的状态栏浮在窗口右下角，正好压在栏底：目录最后一行、图的下沿都被它盖住。
   * 两栏各量一下和它重叠多高，底部让出这么多再加 12。沉浸时状态栏藏了，就只留 12。
   */
  clearFooter(m) {
    const bar = m.host.ownerDocument.querySelector(".status-bar");
    const b = bar?.getBoundingClientRect();
    for (const pane of [m.rail, m.side]) {
      let over = 0;
      // 不看 offsetParent：浮着的（fixed）状态栏它也是 null。藏起来的状态栏量出来高 0。
      if (b?.height && !this.hidden(m)) {
        const r = pane.getBoundingClientRect();
        if (r.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) over = r.bottom - b.top;
      }
      pane.style.setProperty("--lr-foot", `${Math.round(Math.max(0, over)) + 12}px`);
    }
  }
  setImmersive(on) {
    if (on === this.immersive) return;
    const ws = this.app.workspace;
    this.immersive = on;
    document.body.classList.toggle(IMMERSIVE, on);
    if (on) {
      this.restore = { left: ws.leftSplit?.collapsed, right: ws.rightSplit?.collapsed };
      ws.leftSplit?.collapse?.();
      ws.rightSplit?.collapse?.();
    } else if (this.restore) {
      if (this.restore.left === false) ws.leftSplit?.expand?.();
      if (this.restore.right === false) ws.rightSplit?.expand?.();
      this.restore = null;
    }
    // 状态栏藏起来、露出来，页底线跟着变。
    for (const m of this.mounts.values()) { this.paintImmersive(m); this.clearFooter(m); m.pager.soon(true); }
  }
  paintImmersive(m) {
    relabel(m.immersiveButton, this.immersive ? "minimize-2" : "maximize-2", this.immersive ? "退出沉浸（Esc）" : "沉浸阅读");
    m.immersiveButton.setAttribute("aria-pressed", String(this.immersive));
  }

  // ---- 翻页 --------------------------------------------------------------

  /** 没设过就是开：翻页是为「上下滚容易丢了读到哪」做的，关掉它的人自己知道在哪关。 */
  paged() { return this.settings().paged !== false; }
  /** 只在阅读模式翻页。编辑模式要打字，方向键和空格是编辑器的。 */
  page(m) { m.pager.set(this.paged() && m.mode === "preview"); }
  togglePaged(m) {
    this.settings().paged = !this.paged();
    for (const mount of this.mounts.values()) { this.page(mount); this.paintPaged(mount); }
    // 在编辑模式里打开翻页，就是想翻着读：顺手切到阅读模式。
    if (this.paged() && m.mode === "source") {
      const leaf = m.leaf, state = leaf.getViewState?.();
      if (state) leaf.setViewState({ ...state, state: { ...state.state, mode: "preview" } }).catch((error) => new Notice(error.message));
    }
    return this.save();
  }
  paintPaged(m) {
    const on = this.paged();
    relabel(m.pageButton, "book-open", on ? "改回上下滚动" : "翻页阅读");
    m.pageButton.setAttribute("aria-pressed", String(on));
  }

  unmount(m) {
    m.closed = true;
    m.pager.dispose();
    clearTimeout(m.scanTimer); clearTimeout(m.floatTimer);
    if (m.frame) m.host.ownerDocument.defaultView.cancelAnimationFrame(m.frame);
    m.owner?.unload();
    m.resizeObserver?.disconnect();
    for (const fn of m.cleanups) fn();
    m.rail.remove(); m.side.remove(); m.reopen.remove(); m.float.remove();
    m.host.classList.remove("lr-host", "lr-compact", "lr-three", "lr-collapsed");
    for (const name of ["--lr-width", "--lr-nav", "--lr-fig"]) m.host.style.removeProperty(name);
    m.host.closest(".workspace-leaf")?.classList.remove("lr-leaf");
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.setImmersive(false);
    for (const m of this.mounts.values()) this.unmount(m);
    this.mounts.clear();
  }
}

module.exports = { ReadingRail, kindOf };
