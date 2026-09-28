"use strict";

/**
 * 侧栏与弹窗共用的 Markdown 渲染。
 *
 * 用 Obsidian 自己的渲染器，不另起一套：公式、列表、链接的表现和笔记里完全一致，
 * 也不必自己管 MathJax 什么时候加载好。
 */

const { Component, MarkdownRenderer } = require("obsidian");

/** 渲染不出来就退回源码：面板空着比源码更难排查。 */
function fallback(target, markdown, error) {
  console.warn("l-os-study: Markdown 渲染失败，退回源码。", error);
  target.replaceChildren();
  target.classList.add("is-raw");
  target.textContent = markdown;
}

/**
 * 把一段 Markdown 渲染进容器。
 *
 * MarkdownRenderer 是异步的，调用方不等它——侧栏重画很频繁，等它会把列表卡住。
 * owner 决定这些子组件什么时候被回收：传面板或弹窗自己的 Component，关掉即清理。
 */
function renderMarkdown(app, owner, target, markdown, sourcePath = "") {
  target.replaceChildren();
  target.classList.add("markdown-rendered");
  target.classList.remove("is-raw");
  try {
    const result = MarkdownRenderer.render
      ? MarkdownRenderer.render(app, markdown, target, sourcePath, owner)
      : MarkdownRenderer.renderMarkdown(markdown, target, sourcePath, owner);
    void Promise.resolve(result).catch((error) => fallback(target, markdown, error));
  } catch (error) {
    fallback(target, markdown, error);
  }
}

/** 一处 Markdown 渲染的宿主组件；关面板或关弹窗时统一回收子组件。 */
const markdownOwner = () => {
  const owner = new Component();
  owner.load();
  return owner;
};

module.exports = { renderMarkdown, markdownOwner };
