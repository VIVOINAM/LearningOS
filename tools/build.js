"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { bundle } = require("./bundler.js");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const ARGS = process.argv.slice(2);

// 版本号唯一真相源。六个插件锁步同一个版本：它们从来不单独分发，
// 一次构建、一次部署、互相调 API，是一个产品的六个模块。
// 此前各自带一个 manifest.version，结果 study 跑到 5.6.5 而 recall 还在 1.0.0。
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version;

// 设计令牌唯一定义处，内联到每个插件的 styles.css 最前面。
// 每个插件都带一份是故意的：模块可以单独停用，只启用其中一个时令牌也得在。
const TOKENS = fs.readFileSync(path.join(ROOT, "shared", "tokens.css"), "utf8");
// 共用组件（弹窗皮肤）同理：单独启用 codex-capture 时，它的弹窗也得长得对。
const COMPONENTS = fs.readFileSync(path.join(ROOT, "shared", "components.css"), "utf8");
const STAGE_MODE = ARGS.includes("--stage") || process.env.CODEX_STAGE === "1";
const PLUGIN_ROOT = STAGE_MODE ? path.join(ROOT, "dist", "plugins") : path.join(VAULT, ".obsidian", "plugins");
const COMMUNITY = path.join(VAULT, ".obsidian", "community-plugins.json");

// 顺序即依赖顺序：所有者先加载，工作台最后绑定它们。
const PLUGINS = require("./plugins");
const OBSOLETE = ["codex-focus-timer", "codex-capture-v3", "codex-iteration-v3", "codex-workbench-v3", "codex-iteration"];

function updateCommunity(ids) {
  let list = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(COMMUNITY, "utf8"));
    if (Array.isArray(parsed)) list = parsed;
  } catch (error) {
    console.warn(`[警告] 无法读取 community-plugins.json：${error.message}`);
  }
  list = list.filter((id) => !OBSOLETE.includes(id));
  for (const id of [...ids].reverse()) {
    if (!list.includes(id)) list.unshift(id);
  }
  fs.writeFileSync(COMMUNITY, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

function buildPlugin(id) {
  const sourceDir = path.join(ROOT, id);
  const entry = path.join(sourceDir, "main.js");
  const manifestPath = path.join(sourceDir, "manifest.json");
  if (!fs.existsSync(entry)) throw new Error(`${id}: 缺少 main.js`);
  if (!fs.existsSync(manifestPath)) throw new Error(`${id}: 缺少 manifest.json`);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== id) throw new Error(`${id}: manifest.id 应为 ${id}`);
  if (manifest.version) throw new Error(`${id}: 源码 manifest 不应带 version，唯一来源是 version.json`);

  const targetDir = path.join(PLUGIN_ROOT, id);
  fs.mkdirSync(targetDir, { recursive: true });

  const result = bundle(entry);
  fs.writeFileSync(path.join(targetDir, "main.js"), result.code, "utf8");

  // 产物 manifest 的版本号来自 version.json，六个插件同一个值。
  // 此前 manifest 还带一个 changes 字段，由这里从 CHANGELOG 注入、供工作台写版本日志；
  // 版本日志改为部署时生成之后它没有消费者了，一并去掉。
  const { id: manifestId, name, ...rest } = manifest;
  fs.writeFileSync(
    path.join(targetDir, "manifest.json"),
    `${JSON.stringify({ id: manifestId, name, version: VERSION, ...rest }, null, 2)}
`,
    "utf8"
  );

  const styles = path.join(sourceDir, "styles.css");
  if (fs.existsSync(styles)) {
    const railStyles = path.join(sourceDir, 'reading-rail.css');
    const own = fs.readFileSync(styles, "utf8") + (fs.existsSync(railStyles) ? '\n' + fs.readFileSync(railStyles, 'utf8') : '');
    fs.writeFileSync(path.join(targetDir, "styles.css"), `${TOKENS}\n${COMPONENTS}\n${own}`, "utf8");
  }

  console.log(`[部署] ${id} · ${VERSION} · ${result.modules.length} 个模块 · ${(result.code.length / 1024).toFixed(1)} KB -> ${path.relative(VAULT, targetDir)}`);
}

let failed = false;
for (const id of PLUGINS) {
  try {
    buildPlugin(id);
  } catch (error) {
    failed = true;
    console.error(`[失败] ${id}: ${error.message}`);
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  if (!STAGE_MODE) updateCommunity(PLUGINS);
  const obsoleteFound = OBSOLETE.filter((id) => fs.existsSync(path.join(PLUGIN_ROOT, id)));
  if (obsoleteFound.length) {
    console.warn(`[提示] 仍在 plugins 目录中的旧插件：${obsoleteFound.join(", ")}（确认 Obsidian 退出后再删除）`);
  }
  console.log(`构建完成：自包含产物位于 ${path.relative(VAULT, PLUGIN_ROOT)}。`);
}
