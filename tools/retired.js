"use strict";

/**
 * 退役的插件 ID。
 *
 * 7.5 之前插件 ID 以 `codex-` 开头——最初整套插件由 Codex 写成。改名 L-OS 后
 * 新 ID 是 `l-os-*`，一一对应：codex-study → l-os-study。Obsidian 按 ID 找插件目录，
 * 个人数据（data.json）也跟着目录走，所以只改 ID 不搬数据，番茄记录、批注、复习队列
 * 在新插件眼里就是空的。
 *
 * build（直接部署时）与 deploy 都会：
 * - 新目录还没有 data.json、旧目录有，就复制过去（不删旧的，不覆盖新的）；
 * - 把旧 ID 从 community-plugins.json 里剔除，免得 Obsidian 去启用一个不存在的插件；
 * - 旧目录还在就提醒，确认 Obsidian 退出后手动删。
 *
 * 更早删掉的插件（codex-focus-timer、codex-iteration 等）同样是旧前缀，一并算退役。
 */

const fs = require("node:fs");
const path = require("node:path");

const PREFIX = "l-os-";
const LEGACY_PREFIX = "codex-";

const isRetired = (id) => typeof id === "string" && id.startsWith(LEGACY_PREFIX);
const legacyOf = (id) => LEGACY_PREFIX + id.slice(PREFIX.length);

/** 旧目录的 data.json 复制到新目录。返回复制过的插件 ID。 */
function migrateData(pluginRoot, ids) {
  const moved = [];
  for (const id of ids) {
    const from = path.join(pluginRoot, legacyOf(id), "data.json");
    const to = path.join(pluginRoot, id, "data.json");
    if (!fs.existsSync(from) || fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    moved.push(id);
    console.log(`[迁移] ${legacyOf(id)}/data.json -> ${id}/data.json`);
  }
  return moved;
}

/** plugins 目录里还留着的旧插件目录。 */
function leftovers(pluginRoot) {
  if (!fs.existsSync(pluginRoot)) return [];
  return fs.readdirSync(pluginRoot).filter(isRetired);
}

module.exports = { isRetired, legacyOf, migrateData, leftovers };
