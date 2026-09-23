"use strict";

/**
 * PDF 跳转历史。
 *
 * 只记录内部链接、卡片等“明确跳转”，不监听普通滚动。这样返回栈里每一步
 * 都是读者真正离开的阅读位置，而不是滚轮产生的几十个中间状态。
 */
function copyPosition(position) {
  if (!position || !Number.isFinite(Number(position.page))) return null;
  const copy = { page: Math.max(1, Math.round(Number(position.page))) };
  for (const key of ["scale", "top", "left", "pageOffset", "rectY"]) {
    if (position[key] !== undefined) copy[key] = position[key];
  }
  return copy;
}

function samePosition(a, b) {
  if (!a || !b || a.page !== b.page || a.scale !== b.scale) return false;
  const near = (left, right) => Math.abs(Number(left || 0) - Number(right || 0)) < 2;
  return near(a.pageOffset ?? a.top, b.pageOffset ?? b.top) && near(a.left, b.left);
}

function movedPosition(a, b) {
  if (!a || !b) return false;
  if (Number(a.page) !== Number(b.page) || a.scale !== b.scale) return true;
  const distance = (left, right) => Math.abs(Number(left || 0) - Number(right || 0));
  return distance(a.pageOffset ?? a.top, b.pageOffset ?? b.top) >= 8 || distance(a.left, b.left) >= 8;
}

class PdfNavigationHistory {
  constructor(limit = 80) {
    this.limit = limit;
    this.back = [];
    this.forward = [];
  }

  remember(position) {
    const next = copyPosition(position);
    if (!next) return false;
    if (!samePosition(this.back.at(-1), next)) {
      this.back.push(next);
      if (this.back.length > this.limit) this.back.shift();
    }
    this.forward.length = 0;
    return true;
  }

  take(direction, current) {
    const from = direction === "forward" ? this.forward : this.back;
    const to = direction === "forward" ? this.back : this.forward;
    const here = copyPosition(current);
    if (!here) return null;
    while (from.length && samePosition(from.at(-1), here)) from.pop();
    const target = from.pop();
    if (!target) return null;
    if (!samePosition(to.at(-1), here)) {
      to.push(here);
      if (to.length > this.limit) to.shift();
    }
    return copyPosition(target);
  }

  canBack() { return this.back.length > 0; }
  canForward() { return this.forward.length > 0; }
}

function pdfLinkTarget(target, scroll) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  // Obsidian 各版本内置的 PDF.js 对内部链接使用过不同类名：internalLink、
  // linkAnnotation，甚至只留下一个普通 a。结构比类名稳定，因此在 PDF 滚动区内
  // 接受链接或链接注释，再通过跳转前后的位置变化排除外链与普通点击。
  const link = element?.closest?.("a, .linkAnnotation") || null;
  return link && scroll?.contains?.(link) ? link : null;
}

function installPdfNavigation(engine, ctx) {
  ctx.navigationHistory = new PdfNavigationHistory();
  ctx.navigationClick = event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (!pdfLinkTarget(event.target, ctx.scroll)) return;
    const source = engine.position(ctx);
    const started = Date.now();
    clearTimeout(ctx.navigationProbe);
    const probe = () => {
      if (ctx.closed) return;
      if (movedPosition(source, engine.position(ctx))) {
        ctx.navigationProbe = null;
        engine.rememberNavigation(ctx, source);
        return;
      }
      // PDF.js 有时要先解析 named destination；给它一小段时间，但不常驻轮询。
      if (Date.now() - started < 1500) ctx.navigationProbe = ctx.win.setTimeout(probe, 75);
      else ctx.navigationProbe = null;
    };
    ctx.navigationProbe = ctx.win.setTimeout(probe, 0);
  };
  // 捕获阶段先于 PDF.js 自己的链接处理器，保证跳走之前拿到原位置。
  ctx.scroll.addEventListener("click", ctx.navigationClick, true);
}

module.exports = { PdfNavigationHistory, copyPosition, samePosition, movedPosition, pdfLinkTarget, installPdfNavigation };
