"use strict";

/**
 * L-OS 3.0 · PDF 学习模型纯逻辑。
 * 从 workbench 1.7 抽取，供引擎与弹窗共享。
 */

const STUDY_COLORS = {
  yellow: "经典黄",
  mint: "薄荷绿",
  blue: "天蓝",
  purple: "浅紫",
  coral: "珊瑚红",
};
const STUDY_CATEGORY_GROUPS = {
  "知识属性": ["核心定义 / 术语", "定理 / 公式 / 运算法则", "证明技巧 / 推导思路", "典型例题 / 经典反例", "底层直观 / 几何解释", "易混淆点 / 易错陷阱"],
  "认知状态": ["疑问卡壳（待解决）", "需反复复习（记忆点）", "需动手重推（推导不熟）", "核心考点（重点关注）"],
  "网络关联": ["前置依赖（基础知识）", "横向对比（相似概念辨析）", "高阶应用（延伸拓展）"],
};
const STUDY_CATEGORIES = Object.values(STUDY_CATEGORY_GROUPS).flat();
const LEGACY_CATEGORIES = { "概念": "核心定义 / 术语", "例题": "典型例题 / 经典反例", "重难点": "核心考点（重点关注）", "未解疑问": "疑问卡壳（待解决）", "其它": "" };

const studyColor = (value) => {
  const migrated = { red: "coral", green: "mint" }[value] || value;
  return Object.hasOwn(STUDY_COLORS, migrated) ? migrated : "yellow";
};

const parseStudyTags = (value) => [
  ...new Set(
    String(value || "")
      .split(/[,，\s]+/)
      .map((tag) => tag.replace(/^#/, "").trim())
      .filter(Boolean)
      .slice(0, 12)
  ),
];

const parseStudyCategories = (value) => [
  ...new Set(
    (Array.isArray(value) ? value : String(value || "").split(/[,，、]+/))
      .map((item) => String(item).trim())
      .map((item) => Object.hasOwn(LEGACY_CATEGORIES, item) ? LEGACY_CATEGORIES[item] : item)
      .filter((item) => STUDY_CATEGORIES.includes(item))
  ),
];

const parseStudyLinks = (value) => {
  const parts = Array.isArray(value) ? value : String(value || "").split(/[;,；，]+/);
  return parts
    .map((item) => {
      if (item && typeof item === "object") {
        return { page: Math.max(1, Math.floor(Number(item.page) || 1)), label: String(item.label || "").replace(/[\r\n]+/g, " ").trim() };
      }
      const match = String(item).trim().match(/^(\d+)(?:\s*[:：-]\s*(.*))?$/);
      return match ? { page: Number(match[1]), label: String(match[2] || "").replace(/[\r\n]+/g, " ").trim() } : null;
    })
    .filter(Boolean)
    .filter((item, index, list) => list.findIndex((other) => other.page === item.page && other.label === item.label) === index)
    .slice(0, 12);
};

const mergeStudyRects = (value) => {
  const rects = (Array.isArray(value) ? value : [])
    .map((item) => ({ x: Number(item.x), y: Number(item.y), w: Number(item.w), h: Number(item.h) }))
    .filter((item) => Number.isFinite(item.x) && Number.isFinite(item.y) && item.w > 0 && item.h > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const merged = [];
  for (const rect of rects) {
    const previous = merged.at(-1);
    const sameLine = previous && Math.abs(previous.y - rect.y) <= 0.012 && rect.x <= previous.x + previous.w + 0.015;
    if (!sameLine) {
      merged.push(rect);
      continue;
    }
    const right = Math.max(previous.x + previous.w, rect.x + rect.w);
    const bottom = Math.max(previous.y + previous.h, rect.y + rect.h);
    previous.x = Math.min(previous.x, rect.x);
    previous.y = Math.min(previous.y, rect.y);
    previous.w = right - previous.x;
    previous.h = bottom - previous.y;
  }
  return merged;
};

/**
 * 把一条批注整理成复习用的内容。
 *
 * 纯函数放这里，插件那边只负责找到批注和打开 PDF。l-os-recall 通过
 * l-os-study.findCard 拿到的就是这个结构。
 *
 * 排版沿用 5.4.0 定下的规矩：原文在上、自己的话在下，不是 note || text 二选一
 * ——写了批注就看不到原文，复习时尤其要命。
 */
const cardReview = (annotation = {}, path = "") => {
  const quote = String(annotation.text || "").trim();
  const note = String(annotation.note || "").trim();
  const page = Math.max(1, Math.floor(Number(annotation.page) || 1));
  const parts = [];
  if (annotation.imagePath) parts.push(`![[${annotation.imagePath}]]`);
  if (quote) parts.push(quote.split(/\r?\n/).map((line) => `> ${line}`).join("\n"));
  if (note) parts.push(note);
  const question = annotation.kind === "question";
  return {
    id: String(annotation.id || ""),
    page,
    kind: question ? "疑问" : annotation.kind === "region" ? "截图" : "",
    resolved: !!annotation.resolved,
    // 提示语里不放答案：卡片正文才是答案，提示只说去回想什么。
    prompt: question
      ? "先回想这个疑问当时卡在哪里，想通了没有，再展开核对。"
      : "先回想这张卡片讲的是什么，再展开核对。",
    body: parts.join("\n\n") || "（这张卡片没有文字内容）",
    title: `${String(path).split("/").pop().replace(/\.pdf$/i, "")} · 第 ${page} 页`,
  };
};

module.exports = {STUDY_COLORS, STUDY_CATEGORY_GROUPS, studyColor, parseStudyTags, parseStudyCategories, parseStudyLinks, mergeStudyRects, cardReview};
