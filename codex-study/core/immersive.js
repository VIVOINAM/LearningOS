"use strict";

/**
 * 沉浸阅读：只做减法。
 *
 * 这里不新增任何常驻控件、计数或徽章——读书时视野里多一个会涨的数字，
 * 注意力就会被它拿走。进入时挂一个 class，界面元素由 styles.css 隐藏；
 * 退出时原样恢复，不记住、不统计、不提醒。
 */

const IMMERSIVE_CLASS = "cs-immersive";
const DIM_CLASS = "cs-page-dim";

/** 在窗口 body 上开关沉浸标记。返回实际状态，便于调用方对齐。 */
function setImmersive(body, on) {
  if (!body?.classList) return false;
  body.classList.toggle(IMMERSIVE_CLASS, on);
  return on;
}

/** 当前页保持原样，其余页降透明度；关闭时清干净，不留残影。 */
function dimPages(scroll, currentPage, on) {
  const pages = scroll?.querySelectorAll?.(".page[data-page-number]") || [];
  for (const page of pages) {
    page.classList.toggle(DIM_CLASS, Boolean(on) && Number(page.dataset.pageNumber) !== Number(currentPage));
  }
}

module.exports = { IMMERSIVE_CLASS, DIM_CLASS, setImmersive, dimPages };
