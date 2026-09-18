"use strict";

/**
 * 由根 CHANGELOG.md 生成 `00 工作台/版本迭代.md`。
 *
 * 此前这个文件是运行时副作用：codex-workbench 加载时调 recordVersion，
 * 把自己 manifest 里的 changes 写进去。于是它记录的不是「发布了什么」，
 * 而是「这台机器碰巧加载过什么」——codex-study 的二十一个版本一条都没进去，
 * 5.1.4 那一节下面堆着四个版本的说明。为了给这个缺陷打补丁，
 * codex-iteration 里还养着一套 normalize / 去重 / 幂等 upsert。
 *
 * 现在它是纯产物：整篇重写，不读旧内容，不需要去重。
 *
 * 不依赖 Obsidian，可直接 node --test。
 */

const { releases } = require("./changelog.js");

const HEADER = [
  "# 版本迭代",
  "",
  "> 本文由 `node tools/deploy.js` 从 `08 插件开发/CHANGELOG.md` 生成，请勿手改——下次部署会整篇覆盖。",
  "> 要改说明去改 CHANGELOG.md。",
];

/** 把整篇 CHANGELOG 渲染成版本迭代笔记的正文。 */
function render(changelog) {
  const lines = [...HEADER];
  for (const release of releases(changelog)) {
    lines.push("", `## v${release.version}${release.date ? ` · ${release.date}` : " · 未发布"}`, "");
    for (const section of release.sections) {
      if (section.module) lines.push(`**${section.module}**`, "");
      for (const bullet of section.bullets) lines.push(`- ${bullet}`);
      lines.push("");
    }
    // 保留旧日志里的版本锚点：工作台和既有笔记里的链接按它定位。
    lines.push(`<!-- codex-version:${release.version} -->`);
  }
  lines.push("");
  return lines.join("\n");
}

module.exports = { render, HEADER };
