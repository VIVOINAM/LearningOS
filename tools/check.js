"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const STAGE_MODE = process.argv.includes("--stage");
const PLUGIN_ROOT = STAGE_MODE ? path.join(ROOT, "dist", "plugins") : path.join(VAULT, ".obsidian", "plugins");
const PLUGINS = require("./plugins");

function walk(dir, result = []) {
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, result);
    else if (/\.(?:js|cjs|ts)$/.test(entry.name)) result.push(full);
  }
  return result;
}

function syntaxCheck(file) {
  const raw = fs.readFileSync(file, "utf8");
  const code = file.endsWith(".ts") ? require("node:module").stripTypeScriptTypes(raw) : raw;
  new vm.Script(code, { filename: file });
}

let failed = false;
let checkedFiles = 0;

for (const id of PLUGINS) {
  const dir = path.join(ROOT, id);
  const manifestPath = path.join(dir, "manifest.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.id !== id) throw new Error(`manifest.id 应为 ${id}`);
    // 版本号唯一来源是 version.json。源码 manifest 留着 version 就会各自漂移，
    // 所以这里不是「校验它们一致」，而是不许写——写了直接失败。
    if ("version" in manifest) throw new Error("源码 manifest 不应带 version，唯一来源是 version.json");
    if (!manifest.minAppVersion) throw new Error("缺少 minAppVersion");
  } catch (error) {
    failed = true;
    console.error(`[错误] ${id} manifest：${error.message}`);
    continue;
  }

  const files = walk(dir);
  for (const file of files) {
    try {
      syntaxCheck(file);
      checkedFiles += 1;
    } catch (error) {
      failed = true;
      console.error(`[语法错误] ${path.relative(ROOT, file)}：${error.message}`);
    }
  }
  console.log(`[检查] ${id}：${files.length} 个 JS/TS`);
}

for (const file of walk(path.join(ROOT, "shared"))) {
  try { syntaxCheck(file); checkedFiles += 1; }
  catch (error) { failed = true; console.error(`[语法错误] ${path.relative(ROOT, file)}：${error.message}`); }
}

// Built artifacts must be self-contained: no relative require to source directories.
for (const id of PLUGINS) {
  const built = path.join(PLUGIN_ROOT, id, "main.js");
  if (!fs.existsSync(built)) {
    console.warn(`[提示] ${id}: 尚未构建 ${path.relative(VAULT, built)}`);
    continue;
  }
  const code = fs.readFileSync(built, "utf8");
  const relativeRequire = code.match(/require\(\s*["']\.\.?[\\/]/);
  if (relativeRequire) {
    failed = true;
    console.error(`[错误] ${id}: 构建产物仍包含相对 require：${relativeRequire[0]}`);
  }
  if (code.includes("08 插件开发/tools")) {
    failed = true;
    console.error(`[错误] ${id}: 构建产物泄漏源码目录路径。`);
  }
}

// 版本与日志的闸门。此前这些都是 console.warn 然后继续，于是从来没人看见：
// iteration 的 manifest 停在 5.1.0 而 CHANGELOG 最新是 4.6.0，recall 更是只有 1.0.0。
{
  const { releaseFor, releases } = require("./changelog.js");
  const { idFor } = require("./modules.js");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version;
  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf8");

  // 规则 2：CHANGELOG 必须有当前版本的小节，否则版本迭代.md 会少这一节。
  const current = releaseFor(changelog, version);
  if (!current) {
    failed = true;
    console.error(`[错误] CHANGELOG.md 缺少 ${version} 的小节（版本号来自 version.json）。`);
  } else if (!current.sections.length) {
    failed = true;
    console.error(`[错误] CHANGELOG.md 的 ${version} 小节是空的。`);
  } else {
    console.log(`[检查] CHANGELOG.md ${version}：${current.sections.reduce((n, s) => n + s.bullets.length, 0)} 条`);
  }

  // 规则 3：模块名必须在 tools/modules.js 的清单里，写错了不该静默漏掉。
  const unknown = new Set();
  for (const release of releases(changelog)) {
    for (const section of release.sections) {
      if (section.module && !idFor(section.module)) unknown.add(`${release.version} → ${section.module}`);
    }
  }
  if (unknown.size) {
    failed = true;
    console.error(`[错误] CHANGELOG.md 出现未知模块名：${[...unknown].join("、")}`);
  }

  // 插件目录下不该再有各自的 CHANGELOG——那正是六份日志互相漂移的来源。
  for (const id of PLUGINS) {
    if (fs.existsSync(path.join(ROOT, id, "CHANGELOG.md"))) {
      failed = true;
      console.error(`[错误] ${id}/CHANGELOG.md 应已合并进根 CHANGELOG.md。`);
    }
  }
}

// 令牌对比度。眼睛判断这个不可靠，所以做成硬失败而不是文档里的建议。
{
  const { audit } = require("./contrast.js");
  const tokensFile = path.join(ROOT, "shared", "tokens.css");
  if (fs.existsSync(tokensFile)) {
    const results = audit(fs.readFileSync(tokensFile, "utf8"));
    const bad = results.filter((r) => !r.ok);
    for (const r of bad) {
      failed = true;
      const actual = r.actual === null ? `缺少 ${r.missing}` : `${r.actual.toFixed(2)}（需 ≥ ${r.min}）`;
      console.error(`[错误] 对比度 ${r.theme}：${r.a} / ${r.b} = ${actual} —— ${r.why}`);
    }
    if (!bad.length) console.log(`[检查] 令牌对比度：${results.length} 项全部达标。`);
  }
}

// 令牌规则：插件样式里不该再出现品牌色的字面值。
//
// 6.0 先只提示，6.1 转失败——现在还剩个别一次性值（工作台的 accent-color），
// 它们是不是真该单独存在是设计问题，不该由构建脚本替人决定。
// 透明黑（#0002 这类四位带 alpha 的简写）是阴影，不算品牌色，放行。
{
  const tokensFile = path.join(ROOT, "shared", "tokens.css");
  const tokens = fs.existsSync(tokensFile) ? fs.readFileSync(tokensFile, "utf8") : "";
  const known = new Set((tokens.match(/#[0-9a-fA-F]{6}\b/g) || []).map((c) => c.toLowerCase()));
  for (const id of PLUGINS) {
    const file = path.join(ROOT, id, "styles.css");
    if (!fs.existsSync(file)) continue;
    const loose = new Set(
      (fs.readFileSync(file, "utf8").match(/#[0-9a-fA-F]{6}\b/g) || [])
        .map((c) => c.toLowerCase())
        .filter((c) => !known.has(c))
    );
    if (loose.size) {
      console.warn(`[提示] ${id}/styles.css 有 ${loose.size} 个未收进 shared/tokens.css 的色值：${[...loose].join("、")}`);
    }
  }
}

// 规则 4：活文档里不许写死版本号。
//
// 一篇文档要么永远保持正确，要么永远不再改；写了「当前版本：X」的必然是前者伪装成后者。
// 6.0 之前 README 结尾三行分别写着 v4.5.0、5.0、V5.1.5，使用说明写 V5.3，
// 维护记录停在 V4.0，而实际在跑的是 5.4.2——四处没一处说对。
// 快照该进 07 归档/插件版本文档/，活文档指向 version.json 和 CHANGELOG.md。
{
  const STALE = /当前(?:发版)?版本\s*[:：]|当前迭代\s*[:：]/;
  const live = [path.join(ROOT, "README.md")];
  const docsDir = path.join(ROOT, "docs");
  if (fs.existsSync(docsDir)) {
    for (const name of fs.readdirSync(docsDir)) {
      if (name.endsWith(".md")) live.push(path.join(docsDir, name));
    }
  }
  for (const file of live) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!STALE.test(line)) return;
      failed = true;
      console.error(`[错误] ${path.relative(ROOT, file)}:${index + 1} 活文档写死了版本号：${line.trim()}`);
    });
  }
}

console.log(`共检查 ${checkedFiles} 个源码 JS/TS 文件。`);
if (failed) process.exitCode = 1;
else console.log("全部检查通过。");