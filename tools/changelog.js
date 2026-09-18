"use strict";

/**
 * 根 CHANGELOG.md 的解析。
 *
 * 存在的理由：版本说明此前有六份插件 CHANGELOG 加一份 `00 工作台/版本迭代.md`，
 * 后者由 codex-workbench 在加载时写入——于是它记录的不是「发布了什么」，
 * 而是「这台机器碰巧加载过什么」。codex-study 二十一个版本一条都没进去。
 * 现在唯一的源是根 CHANGELOG.md，manifest 版本与版本迭代.md 都是它的产物。
 *
 * 结构：
 *   ## <版本> · <日期>
 *   ### <模块名>
 *   - 条目
 *
 * 不依赖 Obsidian 与文件系统，可直接 node --test。
 */

const VERSION_HEADING = /^##\s+v?([0-9][^\s·]*)\s*(?:·\s*(\S+))?\s*$/;
const MODULE_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^\s*[-*]\s+(.*)$/;

function normalize(value) {
  return String(value || "").replace(/\r\n?/g, "\n");
}

/**
 * 解析整篇日志。
 * 返回 [{ version, date, sections: [{ module, bullets }] }]，顺序与文中一致。
 * 模块小节之前的条目归入 module 为 null 的一节（全产品条目）。
 */
function releases(markdown) {
  const out = [];
  let release = null;
  let section = null;

  const open = (module) => {
    section = { module, bullets: [] };
    release.sections.push(section);
    return section;
  };

  for (const line of normalize(markdown).split("\n")) {
    const version = line.match(VERSION_HEADING);
    if (version) {
      release = { version: version[1].trim(), date: (version[2] || "").trim(), sections: [] };
      section = null;
      out.push(release);
      continue;
    }
    if (!release) continue;

    const module = line.match(MODULE_HEADING);
    if (module) {
      open(module[1]);
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet) {
      const text = bullet[1].trim();
      if (!text) continue;
      (section || open(null)).bullets.push(text);
      continue;
    }
    // 续行：缩进且非空，且前面已经有一条，视为上一条的折行。
    if (section && section.bullets.length && /^\s+\S/.test(line)) {
      section.bullets[section.bullets.length - 1] += ` ${line.trim()}`;
    }
  }

  return out.map((item) => ({ ...item, sections: item.sections.filter((s) => s.bullets.length) }));
}

/** 取某个版本的小节；没有该版本时返回 null。 */
function releaseFor(markdown, version) {
  const target = String(version || "").replace(/^v/, "").trim();
  if (!target) return null;
  return releases(markdown).find((item) => item.version === target) || null;
}

/** 文中出现过的全部版本号，按文中顺序。 */
function versions(markdown) {
  return releases(markdown).map((item) => item.version);
}

module.exports = { releases, releaseFor, versions };
