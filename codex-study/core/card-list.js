"use strict";

/**
 * 卡片列表的纯逻辑：筛选、分窗、分组、标题回退。
 *
 * DOM 之外的部分都放这里，可以直接测，不必起浏览器。
 *
 * 取窗方式参考主流阅读器的注释边栏（Zotero 7 / Kindle 笔记本 / Skim）：
 * 边栏跟着阅读位置走，但不是严格"只看当前页"——翻页时上一页的批注还在视野里，
 * 才接得上思路。这里用当前页 ±2 页作为近邻窗口，其余折叠在"本书其他笔记"。
 */

const NEARBY_RADIUS = 2;

/** 搜索要覆盖卡片上所有写得下字的地方；此前漏了分类和标签。 */
const searchText = (a) => [a.text, a.note, a.page, ...(a.categories || []), ...(a.tags || [])]
  .filter(Boolean).join(" ").toLocaleLowerCase();

const matchesQuery = (a, query) => !query || searchText(a).includes(String(query).toLocaleLowerCase().trim());

/** 颜色与"只看未解决疑问"，对应主流阅读器边栏顶部的颜色筛选。 */
const matchesFilters = (a, { colors, questionOnly } = {}) =>
  (!colors || !colors.size || colors.has(a.color)) &&
  (!questionOnly || (a.kind === "question" && !a.resolved));

/** 截图卡片通常既没有 note 也没有 text，标题为空是正常的——由缩略图来承担辨认。 */
const cardTitle = (a) => String(a?.note || a?.text || "").trim();

/** 远处的卡片按离当前页的距离排，同距离时新的在前。 */
const byPageDistance = (currentPage) => (a, b) =>
  Math.abs(a.page - currentPage) - Math.abs(b.page - currentPage) || (b.createdAt || 0) - (a.createdAt || 0);

function selectCards(annotations, currentPage, options = {}) {
  const { query = "", colors, questionOnly = false, radius = NEARBY_RADIUS } = options;
  const page = Number(currentPage) || 1;
  const cards = (annotations || []).filter((a) => matchesQuery(a, query) && matchesFilters(a, { colors, questionOnly }));
  const near = (a) => Math.abs(a.page - page) <= radius;
  const nearby = cards.filter(near).sort((a, b) => a.page - b.page || (a.createdAt || 0) - (b.createdAt || 0));
  const rest = cards.filter((a) => !near(a)).sort(byPageDistance(page));
  return { total: cards.length, nearby, rest, nearest: rest[0] || null };
}

/**
 * 当前页在分组列表里的落点，供边栏把它推到面板正中。
 *
 * 本页有笔记就对准那一组的中线；本页没笔记就对准它该在的那道缝——
 * 上一页的笔记落在上半、下一页的落在下半，而不是为空页往列表里塞一个占位的东西。
 * pages 必须是升序的页码（groupByPage 的输出就是）。
 */
function anchorIndex(pages, page) {
  const list = pages || [];
  if (!list.length) return null;
  const own = list.indexOf(Number(page));
  if (own >= 0) return { index: own, edge: "center" };
  const after = list.findIndex((p) => p > page);
  if (after >= 0) return { index: after, edge: "top" };
  return { index: list.length - 1, edge: "bottom" };
}

/** 按页分组并保持传入顺序，供边栏画出分页小标题。 */
function groupByPage(cards) {
  const groups = [];
  for (const card of cards || []) {
    const last = groups.at(-1);
    if (last && last.page === card.page) last.cards.push(card);
    else groups.push({ page: card.page, cards: [card] });
  }
  return groups;
}

module.exports = { NEARBY_RADIUS, searchText, matchesQuery, matchesFilters, cardTitle, byPageDistance, selectCards, groupByPage, anchorIndex };
