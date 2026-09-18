"use strict";

/**
 * 只同步 Vault 使用文档，不改动插件产物与 data.json。
 * 用法：node tools/sync-docs.js [--dry-run]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const DRY = process.argv.includes("--dry-run");

// 只同步在 Obsidian 里读的那一篇。
//
// 此前这里还自动同步全部 V*.md，于是 17 组文档在 docs/ 和 00 工作台/ 各存一份。
// 那些是发布快照不是文档，越堆越多，而真正要保持正确的活文档没人改——
// 三处「当前版本」分别写着 V5.1.5、V5.3 和 V4.0，实际是 5.4.2，没一处说对。
// 6.0 起快照进 07 归档/插件版本文档/ 只读，活文档留在 docs/ 里就地读。
const DOC_COPIES = [
  ["docs/使用说明.md", "00 工作台/使用说明.md"],
];

module.exports = { DOC_COPIES };
// deploy.js 复用同一份清单，避免两处各写一遍文档映射。
if (require.main !== module) return;

let failed = false;
for (const [sourceRelative, targetRelative] of DOC_COPIES) {
  const source = path.join(ROOT, sourceRelative);
  const target = path.join(VAULT, targetRelative);
  if (!fs.existsSync(source)) {
    console.error(`[缺少] ${sourceRelative}`);
    failed = true;
    continue;
  }
  if (DRY) {
    console.log(`[就绪] ${targetRelative}`);
    continue;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    console.log(`[文档] ${targetRelative}`);
  } catch (error) {
    console.error(`[失败] ${targetRelative}：${error.message}`);
    failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log(DRY ? "文档源检查完成。" : "文档同步完成。");
