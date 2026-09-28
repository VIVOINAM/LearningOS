"use strict";

/**
 * 课堂笔记有几页：按翻页阅读的断页规则，在一个固定大小的参考页面里量。
 *
 * 为什么不按当前窗口量：页数跟着窗口和字号变，今天缩一下窗口「已总结」就退回「不足两页」，
 * 而「已总结」会勾掉那条总结任务、勾掉的不撤回。所以量的是一个固定的页面——
 * 宽度就是课堂笔记的行宽（reading-rail.css 的 --lr-measure，一行 40 字上下，窗口够宽时本来就是它），
 * 高度取 1280×800 窗口里一页的高度（和 tools/check-note-pages.cjs 的主档同一个尺寸）。
 *
 * 断页不另写一套：直接用 reading-pager.js 的 unitAt / pageCut / keepHeading，
 * 页底那一行露半截就整行留给下一页、标题不落单在页底——和翻页器一模一样。
 * check-note-pages.cjs 在同一份 DOM 上同时跑真翻页器和 countPages，两边页数必须相等。
 */

const { unitAt, pageCut, keepHeading } = require("./reading-pager");

/** 参考页面：正文宽 760（行宽），一页高 764（800 减去翻页器上下各留的 20 + 16）。 */
const PAGE = { measure: 760, height: 764 };
const PAD_TOP = 20;

/**
 * 在已经排好版的 sizer 上数页。viewTop 是滚动容器的上沿（第一页从这里开始，和翻页器在篇首时一样），
 * height 是一页的高度。返回小数页：前面的整页数，加上最后一页用掉的比例。
 */
function countPages(sizer, viewTop, height, win) {
  const blocks = [...sizer.children].filter((n) => n.getBoundingClientRect().height > 0 && !n.matches?.(".markdown-preview-pusher, .mod-footer"));
  if (!blocks.length) return 0;
  const last = blocks.at(-1).getBoundingClientRect().bottom;
  let top = viewTop, bottom = viewTop + PAD_TOP + height;
  for (let pages = 1; pages < 1000; pages++) {
    const cut = keepHeading(sizer, pageCut(unitAt(sizer, bottom, win, height), top, bottom), top);
    if (last <= cut + 1) return pages - 1 + Math.min(1, Math.max(0, (last - top) / height));
    top = cut; bottom = top + height;
  }
  return 1000;
}

const frame = (win) => new Promise((resolve) => { win.requestAnimationFrame(() => resolve()); win.setTimeout(resolve, 60); });

/**
 * 在屏幕外按参考页面渲染一篇课堂笔记并数页。
 * 用 Obsidian 自己的渲染器和课堂笔记的样式（.lr-host / .class-note），公式、图片和阅读时一样排。
 * frontmatter 不渲染：这个库把属性面板藏了，阅读时它不占地方。
 */
async function measureNote(app, file, text, { MarkdownRenderer, Component }) {
  const doc = document, win = doc.defaultView;
  const host = doc.body.createDiv ? doc.body.createDiv() : doc.body.appendChild(doc.createElement("div"));
  host.className = "lr-host lr-paged cw-page-probe";
  host.setAttribute("aria-hidden", "true");
  // 放在屏幕外、不可见，但照常排版：visibility 不影响布局，display:none 才会。
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${PAGE.measure + 120}px;height:${PAGE.height + 36}px;visibility:hidden;pointer-events:none;contain:strict;`;
  host.style.setProperty("--lr-page-height", `${PAGE.height}px`);
  const reading = host.appendChild(doc.createElement("div"));
  reading.className = "markdown-reading-view";
  reading.style.height = "100%";
  const scroller = reading.appendChild(doc.createElement("div"));
  scroller.className = "markdown-preview-view markdown-rendered class-note";
  scroller.style.cssText = "height:100%;overflow:auto;";
  const sizer = scroller.appendChild(doc.createElement("div"));
  sizer.className = "markdown-preview-sizer markdown-preview-section";
  const owner = new Component();
  owner.load();
  try {
    const body = String(text || "").replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
    await MarkdownRenderer.render(app, body, sizer, file.path, owner);
    // 图片嵌入是渲染之后才异步挂上去的：等它们出现、解码完，最多等两秒。
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      await frame(win);
      const pending = [...sizer.querySelectorAll(".internal-embed.image-embed")].filter((e) => !e.querySelector("img"));
      const images = [...sizer.querySelectorAll("img")];
      if (!pending.length && images.every((img) => img.complete)) break;
    }
    await Promise.all([...sizer.querySelectorAll("img")].map((img) => img.decode?.().catch(() => {})));
    await frame(win);
    const pages = countPages(sizer, scroller.getBoundingClientRect().top, PAGE.height, win);
    return Math.round(pages * 10) / 10;
  } finally {
    owner.unload();
    host.remove();
  }
}

module.exports = { PAGE, countPages, measureNote };
