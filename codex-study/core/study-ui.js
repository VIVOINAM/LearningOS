"use strict";

const { STUDY_CATEGORY_GROUPS, parseStudyCategories } = require("./study-model.js");

const { el, btn: domBtn } = require("../../shared/dom.js");

const button = (parent, text, action, cls = "") =>
  domBtn(parent, text, action, `cw-button ${cls}`, error => {
    const { Notice } = require("obsidian");
    new Notice(`操作未完成：${error.message}`);
  });

function studyCategoryPicker(parent, selected = []) {
  const wrap = el(parent, "div", "cw-study-categories");
  el(wrap, "div", "cw-study-field-title", "多维分类（可多选）");
  const checks = new Map();
  const chosen = new Set(parseStudyCategories(selected));
  for (const [group, categories] of Object.entries(STUDY_CATEGORY_GROUPS)) {
    const section=el(wrap,"section","cw-category-group");
    el(section,"div","cw-category-group-title",group);
    const pills=el(section,"div","cw-category-pills");
    for (const category of categories) {
      const label = el(pills, "label", "cw-study-category");
      const check = el(label, "input", "");
      check.type = "checkbox"; check.value = category; check.checked = chosen.has(category);
      el(label, "span", "", category); checks.set(category, check);
    }
  }
  return () => [...checks].filter(([,check])=>check.checked).map(([category])=>category);
}

module.exports = { el, button, studyCategoryPicker };
