"use strict";

/**
 * CODEX 3.0 · 学习数据存储纯逻辑
 *
 * 3.0 的目标是让 codex-study 成为 PDF 学习数据的唯一 owner。
 * 这里不碰 Obsidian API，只负责默认值、规范化与 v1.7 数据迁移。
 */

const DEFAULT_GOAL = Object.freeze({ minutes: 120, pages: 30 });

function defaultStudy() {
  return {
    records: {},
    removedIds: [],
    goal: { ...DEFAULT_GOAL },
    cursor: null,
    activePath: null,
    startedAt: null,
  };
}

function normalizeRecord(record) {
  const source = record && typeof record === "object" ? record : {};
  return {
    position: source.position || null,
    annotations: Array.isArray(source.annotations) ? source.annotations : [],
    daily: source.daily && typeof source.daily === "object" ? source.daily : {},
    dailyPages: source.dailyPages && typeof source.dailyPages === "object" ? source.dailyPages : {},
    pagesSeen: Array.isArray(source.pagesSeen) ? source.pagesSeen : [],
    totalPages: Math.max(0, Math.floor(Number(source.totalPages) || 0)),
    next: String(source.next || ""),
    updatedAt: Number(source.updatedAt) || 0,
  };
}

function normalizeStudy(input) {
  const source = input && typeof input === "object" ? input : {};
  const records = {};
  for (const [path, record] of Object.entries(source.records || {})) {
    records[path] = normalizeRecord(record);
  }
  return {
    records,
    removedIds: Array.isArray(source.removedIds) ? [...new Set(source.removedIds.filter(id => typeof id === 'string'))] : [],
    goal: { ...DEFAULT_GOAL, ...(source.goal || {}) },
    cursor: source.cursor || null,
    activePath: source.activePath || null,
    startedAt: Number(source.startedAt) || null,
  };
}

function recordCount(study) {
  return Object.keys(study?.records || {}).length;
}

function isEmptyStudy(study) {
  return recordCount(study) === 0;
}

/**
 * 迁移策略：新数据非空时以新数据为准；为空时导入 v1.7 workbench 的 study 对象。
 * 返回 isNew=false 表示不需要写盘。
 */
function hasLegacyStudy(study) {
  const normalized = normalizeStudy(study);
  return (
    !isEmptyStudy(normalized) ||
    normalized.cursor != null ||
    Boolean(normalized.activePath) ||
    Boolean(normalized.startedAt) ||
    normalized.goal.minutes !== DEFAULT_GOAL.minutes ||
    normalized.goal.pages !== DEFAULT_GOAL.pages
  );
}

function importLegacyStudy(current, legacy) {
  const normalizedCurrent = normalizeStudy(current);
  if (!isEmptyStudy(normalizedCurrent)) {
    return { study: normalizedCurrent, imported: false };
  }
  if (!legacy || typeof legacy !== "object") {
    return { study: normalizedCurrent, imported: false };
  }
  const normalizedLegacy = normalizeStudy(legacy);
  return { study: normalizedLegacy, imported: hasLegacyStudy(legacy) };
}

/** 把迁移后的数据写回同一个对象引用，避免 StudyEngine 持有的 this.data 失联。 */
function applyStudy(target, incoming) {
  const next = normalizeStudy(incoming);
  target.records = next.records;
  target.removedIds = next.removedIds;
  target.goal = next.goal;
  target.cursor = next.cursor;
  target.activePath = next.activePath;
  target.startedAt = next.startedAt;
  return target;
}

module.exports = {defaultStudy, normalizeStudy, recordCount, isEmptyStudy, importLegacyStudy, applyStudy};
