"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const SOURCE_ROOT = path.join(ROOT, "dist", "plugins");
const TARGET_ROOT = path.join(VAULT, ".obsidian", "plugins");
const COMMUNITY = path.join(VAULT, ".obsidian", "community-plugins.json");
const PLUGINS = require("./plugins");
const RETIRED = require("./retired");
// 与 tools/sync-docs.js 共用一份清单。此前两边各写一遍，deploy 会漏掉新版本说明。
const { DOC_COPIES } = require("./sync-docs");
const { render } = require("./version-log.js");
const VERSION_LOG = path.join(VAULT, "00 工作台", "版本迭代.md");

if (!fs.existsSync(SOURCE_ROOT)) {
  console.error("找不到 dist/plugins，请先运行 npm run build -- --stage。");
  process.exitCode = 1;
} else {
  for (const id of PLUGINS) {
    const source = path.join(SOURCE_ROOT, id);
    const target = path.join(TARGET_ROOT, id);
    if (!fs.existsSync(source)) {
      console.error(`缺少构建产物：${source}`);
      process.exitCode = 1;
      continue;
    }
    fs.mkdirSync(target, { recursive: true });
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
      const file = path.join(source, name);
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(target, name));
    }
    console.log(`[安装] ${id} -> ${target}`);
  }

  if (!process.exitCode) {
    RETIRED.migrateData(TARGET_ROOT, PLUGINS);
    const stale = RETIRED.leftovers(TARGET_ROOT);
    if (stale.length) console.warn(`[提示] 仍在 plugins 目录中的旧插件：${stale.join(", ")}（数据已迁到 l-os-*；确认 Obsidian 退出后再删除）`);
    let list = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(COMMUNITY, "utf8"));
      if (Array.isArray(parsed)) list = parsed;
    } catch (error) {
      console.warn(`[警告] community-plugins.json 读取失败：${error.message}`);
    }
    list = list.filter((id) => !RETIRED.isRetired(id));
    for (const id of [...PLUGINS].reverse()) if (!list.includes(id)) list.unshift(id);
    fs.writeFileSync(COMMUNITY, `${JSON.stringify(list, null, 2)}\n`, "utf8");
    console.log("[启用] community-plugins.json 已更新。");
    for (const [sourceRelative, targetRelative] of (PLUGINS.includes('l-os-workbench') ? DOC_COPIES : [])) {
      const source = path.join(ROOT, sourceRelative);
      const target = path.join(VAULT, targetRelative);
      if (!fs.existsSync(source)) continue;
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
        console.log(`[文档] ${targetRelative}`);
      } catch (error) {
        console.warn(`[提示] 文档未更新 ${targetRelative}：${error.message}`);
      }
    }
    // 版本迭代.md 是产物，整篇重写。此前它由工作台在加载时追加，
    // 漏记与重复都只能靠 l-os-iteration 的去重逻辑事后补救。
    try {
      fs.mkdirSync(path.dirname(VERSION_LOG), { recursive: true });
      fs.writeFileSync(VERSION_LOG, render(fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8")), "utf8");
      console.log("[日志] 00 工作台/版本迭代.md 已由 CHANGELOG.md 生成。");
    } catch (error) {
      console.error(`[失败] 版本迭代.md 生成失败：${error.message}`);
      process.exitCode = 1;
    }

    console.log("部署完成。请在 Obsidian 中按 Ctrl+R，或重启 Obsidian。");
  }
}
