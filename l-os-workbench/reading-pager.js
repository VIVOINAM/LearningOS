"use strict";

/**
 * 课堂笔记翻页阅读（7.4）：阅读模式下一屏是一页，左右翻。
 *
 * 上下滚动的问题是「读到哪了」没有边界：一滚一小段，眼睛要重新找刚才那一行，
 * 滚多了就不知道在第几屏。翻页把这件事交给页：一页读完，整页换掉，下一页从页首读起。
 *
 * - 不做 CSS 分栏。Obsidian 的阅读视图只渲染屏幕上下各一屏（见 app.js 的 updateVirtualDisplay），
 *   分栏会把竖向滚动取消掉，按需渲染跟着失灵。这里仍然是那个竖着滚的容器，只是每次滚整一页，
 *   翻一页正好落在它已经渲染好的范围里。
 * - 页在行的边界上断：页底那一行（或那张图、那一行表格）只露出半截时，它整个留给下一页，
 *   这一页底下剪掉。标题不落单在页底，跟着下一页走。剪用 clip-path，不盖色块——笔记底下可能是壁纸。
 * - 翻的动作是水平的：旧页往左退，新页从右边进来；往回翻反过来。系统要求减少动效时直接换。
 * - 滚轮、方向键、PageUp/PageDown、空格、触控横扫都是翻一页。一次手势只翻一页——
 *   触控板的惯性会连着发一秒钟滚轮事件，不收住就是一下翻五页。
 * - 不显示页码。视野边上一个会涨的数字，本身就是分心的东西。
 */

const PAD_TOP = 20;       // 页首离容器顶的空
const PAD_BOTTOM = 16;    // 页底离容器底（或状态栏）的空
const MIN_PAGE = 48;      // 一页至少往前走这么多，否则不按行断，硬切（一张比一屏还高的图）
const WHEEL_GAP = 220;    // 滚轮停这么久算一次新手势
const WHEEL_STEP = 50;    // 一次手势累计到这么多才翻
const ATOMIC = new Set(["IMG", "SVG", "VIDEO", "CANVAS", "IFRAME", "HR", "MJX-CONTAINER", "PICTURE", "OBJECT"]);

// ---- 纯函数：不碰 DOM，可直接 node --test --------------------------------

/** 方向键 / 翻页键 / 空格 → 1（下一页）、-1（上一页）、0（不管）。带 Ctrl、Alt、Meta 的是别人的快捷键。 */
function keyDirection(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey) return 0;
  switch (event.key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": return 1;
    case "ArrowLeft": case "ArrowUp": case "PageUp": return -1;
    case " ": case "Spacebar": return event.shiftKey ? -1 : 1;
    default: return 0;
  }
}

/**
 * 一次滚轮事件该不该翻页。state 在调用之间保留：{ at, sum, used }。
 * 停顿超过 WHEEL_GAP 是新手势；一次手势累计过 WHEEL_STEP 翻一页，之后这次手势剩下的事件都吞掉。
 * 横向滚动（触控板左右划）和竖向一样算：往右、往下是下一页。
 */
function wheelStep(state, event, now) {
  const scale = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
  const dx = (Number(event.deltaX) || 0) * scale, dy = (Number(event.deltaY) || 0) * scale;
  const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
  if (now - (state.at ?? -Infinity) > WHEEL_GAP) { state.sum = 0; state.used = false; }
  state.at = now;
  if (state.used || !delta) return 0;
  // 反向了就从头累计：往下滚了一点又往回，不该把两次抵消成零再翻。
  if (state.sum && Math.sign(state.sum) !== Math.sign(delta)) state.sum = 0;
  state.sum += delta;
  if (Math.abs(state.sum) < WHEEL_STEP) return 0;
  state.used = true;
  return Math.sign(state.sum);
}

/** 触控 / 手写笔的一划：往左或往上划是下一页。太短、太慢的不算，那是点或者选字。 */
function swipeDirection(dx, dy, ms) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ms > 900 || Math.max(ax, ay) < 40) return 0;
  return ax >= ay ? (dx < 0 ? 1 : -1) : (dy < 0 ? 1 : -1);
}

/**
 * 这一页在哪断。unit 是跨过页底线的那一行 / 那张图（没有就是页底落在空白里）。
 * 断在它上沿；断了之后这一页几乎没东西（一张比一屏还高的图），就硬切在页底线上。
 */
function pageCut(unit, top, bottom) {
  let cut = unit ? Math.min(unit.top, bottom) : bottom;
  if (cut < top + MIN_PAGE) cut = bottom;
  return cut;
}

/**
 * 跳转（目录、搜索、Home）之后，页从哪一行开始。y 是容器顶。
 * 跨在顶上那一行露出一半以上就整行留着，否则算上一页的，从它下沿开始；
 * 一张很高的图露着尾巴时不从图下面开始，免得整页空着。
 */
function pageStart(unit, y, height) {
  if (!unit) return y;
  const size = unit.bottom - unit.top;
  if (unit.bottom - y >= size / 2) return Math.min(unit.top, y);
  return unit.bottom - y <= height * 0.35 ? unit.bottom : y;
}

// ---- DOM：量「跨过某条横线的那一行」 --------------------------------------

function isAtomic(node, win) {
  if (ATOMIC.has(node.tagName.toUpperCase())) return true;
  return win.getComputedStyle(node).display === "table-row";
}
function isInline(node, win) {
  return win.getComputedStyle(node).display.startsWith("inline");
}
const straddles = (r, y) => r.height > 0 && r.top < y && r.bottom > y;

/**
 * 跨过横线 y 的最小单位：一行字、一张图、一个公式、一行表格。y 落在块与块之间的空白里返回 null。
 * 块级的子元素一路往里找；到了只剩行内内容的那一层，按文字的行框量。
 */
function unitAt(container, y, win, pageHeight = Infinity) {
  for (const child of container.children) {
    const r = child.getBoundingClientRect();
    if (!straddles(r, y)) continue;
    // 短段落/提示框整体移到下一页；超长表格行必须允许按内部文字行续读。
    const block = child.matches?.("p, li, blockquote, .callout, .math-block, pre");
    if ((isAtomic(child, win) && (r.height <= pageHeight || ATOMIC.has(child.tagName.toUpperCase()))) ||
        (block && r.height <= pageHeight * 0.45)) return { top: r.top, bottom: r.bottom };
    if (isInline(child, win)) return lineAt(container, y, win);
    // 往里找没找到不等于这里是空白：Obsidian 列表项里的圆点是一个 flex 的 span.list-bullet，
    // 和那一行字并排、同样跨线，里面却没有字。实机上第一页就是这样被拦腰切了一行。
    const inner = unitAt(child, y, win, pageHeight);
    if (inner) return inner;
  }
  return lineAt(container, y, win);
}

/** 行框：文字的每一行各有一个矩形；行内的图和公式按它自己的框算，和同一行的字合成一行。 */
function lineAt(container, y, win) {
  const range = container.ownerDocument.createRange();
  let top = Infinity, bottom = -Infinity;
  const take = (r) => { if (straddles(r, y)) { top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); } };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        if (!child.data.trim()) continue;
        range.selectNodeContents(child);
        for (const r of range.getClientRects()) take(r);
      } else if (child.nodeType === 1) {
        const r = child.getBoundingClientRect();
        if (!straddles(r, y)) continue;
        if (isAtomic(child, win)) take(r); else walk(child);
      }
    }
  };
  walk(container);
  range.detach?.();
  return top < bottom ? { top, bottom } : null;
}

const HEADING = /^H[1-6]$/;
function isHeading(node) {
  if (/(^|\s)el-h[1-6](\s|$)/.test(node.className || "")) return true;
  return HEADING.test(node.tagName) || HEADING.test(node.firstElementChild?.tagName || "");
}

/**
 * 标题不落单在页底：断点前紧挨着的是一个标题（它下面最多只露了一两行），就把标题也挪到下一页。
 * 连着几个标题（「2 · 例题逐题解析」紧跟「2.1 吊钩」）要一起挪：实机上只挪了 2.1，
 * 「2 · 例题逐题解析」一个人留在页底，底下一大片空白。
 */
function keepHeading(sizer, cut, top) {
  let moved = cut;
  for (let i = 0; i < 6; i++) {
    const heading = orphanBefore(sizer, moved);
    if (heading == null) return moved;
    // 整串挪过去这一页就空了（标题本来就在页首附近）：一个都不挪，
    // 挪一半会把上一级标题单独留在页首。
    if (heading < top + MIN_PAGE) return cut;
    moved = heading;
  }
  return moved;
}
/** 断点前紧挨着的标题的上沿；不是标题，或者标题下面已经跟着几行正文，返回 null。 */
function orphanBefore(sizer, cut) {
  let prev = null, next = null;
  for (const child of sizer.children) {
    const r = child.getBoundingClientRect();
    if (!r.height) continue;
    if (r.bottom <= cut + 1) prev = { node: child, r };
    else { next = r; break; }
  }
  if (!prev || !isHeading(prev.node)) return null;
  // 篇末的空标题没有后续正文需要同行；不能把一屏能放下的短笔记拆成两页。
  if (!next || cut - prev.r.bottom > 64) return null;
  if (next && cut - next.top > 64) return null;
  return prev.r.top;
}

// ---- 翻页器 --------------------------------------------------------------

/** 等一帧；窗口在后台时 rAF 停摆，最多等 60ms，不让翻页卡在半路。 */
const frame = (win) => new Promise((resolve) => { win.requestAnimationFrame(() => resolve()); win.setTimeout(resolve, 60); });

class Pager {
  /**
   * host 是笔记的 view-content（阅读栏的宿主）。options：
   * - active()：这篇笔记是不是当前活动的那一格（按键只给它）。
   * - renderer()：Obsidian 阅读视图的渲染器，用它的 sections 判断是否到了篇末；没有就按 DOM 判断。
   */
  constructor(host, options = {}) {
    this.host = host;
    this.doc = host.ownerDocument;
    this.win = this.doc.defaultView;
    this.options = options;
    this.on = false;
    this.cur = null;      // 本页页首的锚（见 anchor）
    this.aligned = false; // 页首是否钉在页首线上（篇首那一页滚不到，不钉）
    this.start = 0;       // 本页页首，按 sizer 顶算的坐标；每次 paint 从锚重新算
    this.end = 0;         // 本页页底
    this.back = [];       // 往回翻的页首
    this.forward = [];    // 往回翻之后，再往前翻要回到的页首
    this.busy = false;
    this.own = null;      // 自己设的 scrollTop；滚动事件里拿它区分「我翻的」和「跳转来的」
    this.wheel = {};
    this.cleanups = [];
    this.listen();
  }

  listen() {
    const listen = (target, name, fn, opts) => { target.addEventListener(name, fn, opts); this.cleanups.push(() => target.removeEventListener(name, fn, opts)); };
    const inPage = (event) => this.on && !!event.target?.closest?.(".markdown-reading-view .markdown-preview-view");
    listen(this.host, "wheel", (event) => {
      if (!inPage(event) || event.ctrlKey) return;
      // 宽表格、长代码自己能横着滚的，横向滚轮留给它们。
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && this.scrollsSideways(event.target)) return;
      event.preventDefault();
      const dir = wheelStep(this.wheel, event, event.timeStamp || Date.now());
      if (dir) this.flip(dir);
    }, { passive: false, capture: true });
    listen(this.win, "keydown", (event) => {
      if (!this.on || event.defaultPrevented || !this.options.active?.()) return;
      const dir = keyDirection(event);
      if (!dir || !this.keyIsMine(event)) return;
      event.preventDefault();
      event.stopPropagation();
      this.flip(dir);
    }, true);
    // 手写笔在这台机器上是 touch（见 tablet-pen-setup）；鼠标拖动是选字，不管。
    let touch = null;
    listen(this.host, "pointerdown", (event) => {
      // 新按下的一下不是划的尾巴：划完马上点目录，这一下要算数。
      this.swallow = 0;
      touch = inPage(event) && event.pointerType !== "mouse" && event.isPrimary ? { x: event.clientX, y: event.clientY, t: event.timeStamp, id: event.pointerId } : null;
    }, true);
    listen(this.host, "pointerup", (event) => {
      if (!touch || event.pointerId !== touch.id) return;
      const dir = swipeDirection(event.clientX - touch.x, event.clientY - touch.y, event.timeStamp - touch.t);
      touch = null;
      if (!dir) return;
      this.swallow = event.timeStamp;
      this.flip(dir);
    }, true);
    listen(this.host, "pointercancel", () => { touch = null; }, true);
    // 划完抬笔那一下不许落成点击：划过一个链接会打开它。
    listen(this.host, "click", (event) => {
      if (this.swallow && event.timeStamp - this.swallow < 600) { event.preventDefault(); event.stopPropagation(); }
      this.swallow = 0;
    }, true);
    listen(this.host, "scroll", (event) => {
      if (!this.on || !event.target?.matches?.(".markdown-reading-view .markdown-preview-view")) return;
      if (this.own != null && Math.abs(event.target.scrollTop - this.own) < 2) return;
      // 不是自己翻的：目录跳转、页内搜索、Home / End。停稳了按新位置重新分页。
      this.releaseForJump();
    }, { capture: true, passive: true });
    if (this.win.ResizeObserver) {
      this.observer = new this.win.ResizeObserver(() => this.soon());
      this.cleanups.push(() => this.observer.disconnect());
    }
    if (this.win.MutationObserver) {
      // 虚拟渲染替换等高占位块时 sizer 尺寸不变，ResizeObserver 不会通知。
      this.mutations = new this.win.MutationObserver(() => this.soon());
      this.cleanups.push(() => this.mutations.disconnect());
    }
    listen(this.host, "load", () => this.soon(), true);
  }

  scrollsSideways(target) {
    for (let node = target; node && !node.matches?.(".markdown-preview-view"); node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(this.win.getComputedStyle(node).overflowX)) return true;
    }
    return false;
  }
  keyIsMine(event) {
    const target = event.target;
    if (target?.closest?.("input, textarea, select, [contenteditable='true'], .lr-resizer, .modal-container, .prompt, .menu")) return false;
    if (this.doc.querySelector(".modal-container, .menu, .suggestion-container, .prompt")) return false;
    // 空格在按钮上是「按下它」。
    if (event.key === " " && target?.closest?.("button, a, [role='button']")) return false;
    return true;
  }

  // ---- 开关 ----

  /** 目录/搜索滚动期间释放旧锚点，避免虚拟渲染的通知把视口拉回旧页。 */
  releaseForJump(resolveTarget) {
    if (!this.on) return;
    if (resolveTarget) this.jumpTarget = resolveTarget;
    this.jumping = true;
    this.host.querySelector(".markdown-reading-view .markdown-preview-sizer")?.style.removeProperty("clip-path");
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => this.resync(), 180);
  }

  set(on) {
    on = !!on;
    if (on === this.on) { if (on) this.soon(true); return; }
    this.on = on;
    this.host.classList.toggle("lr-paged", on);
    if (!on) { this.clear(); return; }
    this.soon(true);
  }
  clear() {
    clearTimeout(this.settleTimer);
    this.jumping = false;
    this.jumpTarget = null;
    this.observer?.disconnect();
    this.mutations?.disconnect();
    this.host.style.removeProperty("--lr-page-height");
    this.observed = null;
    this.back = []; this.forward = []; this.own = null;
    const sizer = this.host.querySelector(".markdown-reading-view .markdown-preview-sizer");
    if (sizer) {
      sizer.getAnimations?.().forEach((a) => a.cancel());
      for (const name of ["clip-path", "opacity"]) sizer.style.removeProperty(name);
    }
  }
  /** 尺寸或内容变了：窗口宽高变了要重新分页；只是图片加载完之类，保住页首、重画页底。 */
  soon(reset = false) {
    if (!this.on) return;
    this.pendingReset ||= reset;
    if (this.pending) return;
    this.pending = true;
    this.win.requestAnimationFrame(() => {
      this.pending = false;
      this.observe();
      const g = this.geometry();
      if (!g) return;
      const size = `${g.scroller.clientWidth}x${g.scroller.clientHeight}`;
      const reset = this.pendingReset || size !== this.size;
      this.pendingReset = false;
      this.size = size;
      if (reset) this.resync(); else if (!this.busy) this.paint();
    });
  }
  /**
   * 容器在 DOM 里就挂上，不等它量得出尺寸：在后台标签页里启用的翻页器（插件重载、开着几篇笔记）
   * 量不到东西，第一稿就一直没挂——切回这篇时没人通知它，整页停在上一次的剪裁里。
   */
  observe() {
    const scroller = this.host.querySelector(".markdown-reading-view .markdown-preview-view");
    const sizer = scroller?.querySelector(":scope > .markdown-preview-sizer");
    if (!sizer || this.observed === sizer) return;
    this.observer?.disconnect();
    this.observer?.observe(scroller);
    this.observer?.observe(sizer);
    this.mutations?.disconnect();
    this.mutations?.observe(sizer, { childList: true, subtree: true, characterData: true });
    this.observed = sizer;
  }

  // ---- 量 ----

  geometry() {
    const scroller = this.host.querySelector(".markdown-reading-view .markdown-preview-view");
    const sizer = scroller?.querySelector(":scope > .markdown-preview-sizer");
    if (!sizer || !scroller.clientHeight) return null;
    const sr = scroller.getBoundingClientRect();
    let bottom = sr.top + scroller.clientHeight - PAD_BOTTOM;
    // 状态栏浮在窗口右下角，压在正文上的那一截不算页面。
    const bar = this.doc.querySelector(".status-bar")?.getBoundingClientRect();
    if (bar?.height && bar.left < sr.right && bar.right > sr.left && bar.top < bottom + PAD_BOTTOM) bottom = Math.min(bottom, bar.top - 10);
    const top = sr.top + PAD_TOP;
    if (bottom - top < 160) return null;
    const heightValue = `${bottom - top}px`;
    if (this.host.style.getPropertyValue("--lr-page-height") !== heightValue)
      this.host.style.setProperty("--lr-page-height", heightValue);
    const zr = sizer.getBoundingClientRect();
    return { scroller, sizer, view: sr.top, top, bottom, height: bottom - top, sizerTop: zr.top, sizerHeight: zr.height };
  }
  /** 从 y（屏幕坐标）起的这一页在哪断。 */
  cutFrom(g, y) {
    return keepHeading(g.sizer, pageCut(unitAt(g.sizer, g.bottom, this.win, g.height), y, g.bottom), y);
  }
  /** 这一页之后还有没有内容。渲染器没渲染的段落不在 DOM 里，所以先问它最后一段是不是已经画出来了。 */
  atEnd(g) {
    const sections = this.options.renderer?.()?.sections;
    let last = null;
    if (Array.isArray(sections) && sections.length) {
      // shown=false 也可能是尚未进入渲染窗口，不能把它当作文章不存在的尾部。
      const s = [...sections].reverse().find((x) => !(x.computed && !x.height));
      if (s && !g.sizer.contains(s.el)) return false;
      last = s?.el || null;
    }
    if (!last) last = [...g.sizer.children].reverse().find((n) => n.getBoundingClientRect().height > 0 && !n.matches(".markdown-preview-pusher, .mod-footer"));
    return !last || last.getBoundingClientRect().bottom <= g.sizerTop + this.end + 1;
  }
  /** 篇首：页首已经在第一行，而且容器滚到了顶。 */
  atStart(g) {
    return g.scroller.scrollTop <= 1 && this.start <= g.view - g.sizerTop + 1;
  }

  // ---- 位置：锚在段落上 ----

  /**
   * 页首记成「哪一段 + 段内偏移」，不记成 sizer 里的像素。Obsidian 翻过去之后会重新量上面的段落，
   * 实机上整篇跟着上移了 16px：按像素记的页首落进了上一页最后一行的中间，新页顶上露出半行旧字。
   * 段落元素是渲染器复用的，它自己的排版不变，锚在它上面就跟着它走。
   */
  anchor(g, y) {
    const client = g.sizerTop + y;
    for (const el of g.sizer.children) {
      if (el.matches?.(".markdown-preview-pusher")) continue;
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom > client) return { y, el, dy: client - r.top };
    }
    return { y, el: null, dy: 0 };
  }
  /** 锚现在在 sizer 里的哪儿。段落已经被渲染器收走了（离得太远），退回记下的像素。 */
  at(g, pos) {
    if (pos?.el && pos.el.parentElement === g.sizer) {
      const r = pos.el.getBoundingClientRect();
      if (r.height) return r.top + pos.dy - g.sizerTop;
    }
    return pos ? pos.y : 0;
  }

  // ---- 分页与翻页 ----

  /** 把页首放到页首线上。滚不到的（篇首）就停在滚得到的地方，那一页不算对齐。 */
  place(g, pos) {
    const want = g.scroller.scrollTop + (g.sizerTop + this.at(g, pos)) - g.top;
    g.scroller.scrollTop = Math.max(0, want);
    this.own = g.scroller.scrollTop;
    this.cur = pos;
    this.aligned = want >= 0;
  }
  /** 按当前位置重新分页：从屏幕顶上第一整行开始，前后的翻页记录作废。 */
  resync() {
    if (!this.on || this.busy) return;
    clearTimeout(this.settleTimer);
    this.jumping = false;
    const g = this.geometry();
    if (!g) return;
    this.back = []; this.forward = [];
    const target = this.jumpTarget?.();
    this.jumpTarget = null;
    if (target && g.sizer.contains(target)) this.place(g, this.anchor(g, target.getBoundingClientRect().top - g.sizerTop));
    else if (g.scroller.scrollTop <= 1) { this.cur = this.anchor(g, g.view - g.sizerTop); this.aligned = false; this.own = 0; }
    else this.place(g, this.anchor(g, pageStart(unitAt(g.sizer, g.view + 1, this.win), g.view, g.height) - g.sizerTop));
    this.paint();
  }
  /**
   * 剪掉页首以上、页底以下：只剩这一页。
   * 上面的段落重新量过、整篇挪了位置时（尺寸监听会叫到这里），先把页首按锚点挪回页首线，再量页底。
   */
  paint() {
    if (!this.on || !this.cur || this.jumping) return;
    let g = this.geometry();
    if (!g) return;
    // MutationObserver 可能先于 scroll 事件到达，同样不能用旧锚覆盖外部跳转。
    if (!this.busy && this.own != null && Math.abs(g.scroller.scrollTop - this.own) > 2) {
      this.releaseForJump();
      return;
    }
    const drift = g.sizerTop + this.at(g, this.cur) - g.top;
    if (this.aligned && Math.abs(drift) > 0.5) {
      g.scroller.scrollTop += drift;
      this.own = g.scroller.scrollTop;
      g = this.geometry();
    }
    this.start = this.at(g, this.cur);
    let cut = this.cutFrom(g, Math.max(g.sizerTop + this.start, g.view));
    const next = this.forward.at(-1);
    if (next) cut = Math.min(cut, g.sizerTop + this.at(g, next));
    this.end = cut - g.sizerTop;
    const top = Math.max(0, this.start), bottom = Math.max(0, g.sizerHeight - this.end);
    g.sizer.style.setProperty("clip-path", `inset(${top.toFixed(1)}px -100vw ${bottom.toFixed(1)}px -100vw)`);
  }

  next(g) {
    if (this.atEnd(g)) return null;
    this.back.push(this.cur);
    return this.forward.length ? this.forward.pop() : this.anchor(g, this.end);
  }
  prev(g) {
    if (this.atStart(g)) return null;
    this.forward.push(this.cur);
    if (this.back.length) return this.back.pop();
    // 没有翻过来的记录（刚跳转过来）：往上量一页高，从那里第一整行开始。
    const y = g.sizerTop + this.start - g.height;
    if (y <= g.view - g.scroller.scrollTop) return this.anchor(g, g.view - g.scroller.scrollTop - g.sizerTop);
    return this.anchor(g, pageStart(unitAt(g.sizer, y, this.win), y, g.height) - g.sizerTop);
  }

  async flip(dir) {
    if (!this.on || this.busy) return;
    if (this.jumping) this.resync();
    // 图片/公式可能刚完成排版。下一页必须从此刻的裁剪边界开始。
    this.paint();
    const g = this.geometry();
    if (!g) return;
    const target = dir > 0 ? this.next(g) : this.prev(g);
    if (!target) { this.bump(g.sizer, dir); return; }
    this.busy = true;
    const sizer = g.sizer;
    try {
      await this.slide(sizer, dir, "out");
      // 退场到进场之间要一直看不见，用行内样式撑着，最后一定撤掉。
      // 第一稿用 fill: forwards 撑：实机上动画取消之后，它的终态（左移 28、透明）还留在元素上，整篇笔记成了白纸。
      if (!this.reduced()) sizer.style.opacity = "0";
      if (!this.on) return;
      const current = this.geometry();
      if (!current) return;
      this.place(current, target);
      // 滚过去之后渲染器要补画新露出来的段落，等两帧再量页底。
      await frame(this.win); await frame(this.win);
      this.paint();
      await this.slide(sizer, dir, "in");
      this.options.onFlip?.(dir);
    } finally {
      sizer.style.removeProperty("opacity");
      this.busy = false;
    }
    // 渲染器有时过一会儿才量完新露出来的段落；再对一次，页首不动、页底重量。
    this.win.setTimeout(() => this.soon(), 300);
  }

  reduced() { return !!this.win.matchMedia?.("(prefers-reduced-motion: reduce)").matches; }
  /** 一段过场。不留终态（不用 fill）；窗口在后台时动画时钟会停，最多等它跑完的时长再多一点。 */
  slide(sizer, dir, phase) {
    sizer.getAnimations?.().forEach((a) => a.cancel());
    if (!sizer.animate || this.reduced()) return Promise.resolve();
    const x = 28 * dir;
    const out = phase === "out", duration = out ? 110 : 180;
    const animation = sizer.animate(out
      ? [{ transform: "translateX(0)", opacity: 1 }, { transform: `translateX(${-x}px)`, opacity: 0 }]
      : [{ transform: `translateX(${x}px)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }],
    { duration, easing: out ? "cubic-bezier(.4,0,1,1)" : "cubic-bezier(0,0,.2,1)" });
    // 进场动画从透明开始，接得住退场时撑着的行内透明；它一跑起来就可以撤掉行内样式。
    if (!out) sizer.style.removeProperty("opacity");
    const late = new Promise((resolve) => this.win.setTimeout(resolve, duration + 150));
    return Promise.race([animation.finished.catch(() => {}), late]).then(() => animation.cancel());
  }
  /** 到头了：往那个方向顶一下再弹回来，不弹通知。 */
  bump(sizer, dir) {
    if (this.reduced() || !sizer.animate) return;
    const x = -10 * dir;
    sizer.animate([{ transform: "translateX(0)" }, { transform: `translateX(${x}px)` }, { transform: "translateX(0)" }], { duration: 240, easing: "ease-out" });
  }

  dispose() {
    this.set(false);
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
  }
}

module.exports = { Pager, keyDirection, wheelStep, swipeDirection, pageCut, pageStart, unitAt, keepHeading };
