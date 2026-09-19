"use strict";

/**
 * 发一个版本。
 *
 *   node tools/release.js 6.0.1
 *   node tools/release.js --dry-run 6.0.1
 *
 * 存在的理由：6.0 之前发版是手工七步——改 manifest、改 CHANGELOG、有时改
 * package.json、有时改 description 里的版本字样、改 README 的「当前版本」、
 * 写一篇《V5.x 发布与验收》、跑 deploy。没有一步有校验，漏掉任何一步没人知道。
 * 结果是 34 个版本号对应 11 个 commit、4 个 tag，最新的 tag 停在 v4.0.0，
 * 5.3 到 5.6.5 在 git 里根本不存在——版本号指向的只是一段 markdown。
 *
 * 最后一步打 tag 才是整件事的落点：从此每个版本号都指向一个 git 对象，
 * `git checkout v6.0.0 && node tools/deploy.js` 能把 vault 带回那个状态。
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const VERSION_FILE = path.join(ROOT, "version.json");
const PACKAGE_FILE = path.join(ROOT, "package.json");
const CHANGELOG_FILE = path.join(ROOT, "CHANGELOG.md");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--"));

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// 任何一步失败都要把已经写进去的版本号还原，否则工作区留下半个版本，
// 而下一次发版的第一道闸门正是「工作区必须干净」。
let cleanup = null;

function die(message) {
  if (cleanup) {
    cleanup();
    cleanup = null;
    console.error("[还原] version.json、package.json、CHANGELOG.md 已回到发版前的样子。");
  }
  console.error(`[中止] ${message}`);
  process.exit(1);
}

function git(...argv) {
  const result = spawnSync("git", argv, { cwd: ROOT, encoding: "utf8" });
  if (result.error) die(`git ${argv[0]} 无法执行：${result.error.message}`);
  return result;
}

function run(script, ...argv) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...argv], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (result.error) die(`${script} 无法执行：${result.error.message}`);
  if (result.status !== 0) die(`${script} 失败，退出码 ${result.status}。`);
}

function today() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ---- 1. 参数与工作区 ----------------------------------------------------

if (!target) die("用法：node tools/release.js [--dry-run] <版本号>");
if (!SEMVER.test(target)) die(`版本号格式不对：${target}（要 6.0.1 这样的三段式）`);

const status = git("status", "--porcelain");
if (status.status !== 0) die("不在 git 仓库里，或 git 不可用。");
if (status.stdout.trim()) {
  die(
    `工作区不干净，先提交或丢弃改动再发版（${status.stdout.trim().split("\n").length} 项）。\n` +
      "  发版会把当前状态整体固定成一个 tag，混进未审阅的改动就白打了。"
  );
}

const tags = git("tag", "--list", `v${target}`);
if (tags.stdout.trim()) die(`tag v${target} 已存在。换一个版本号，或先删掉那个 tag。`);

// ---- 2. 校验 CHANGELOG --------------------------------------------------

const { releases } = require("./changelog.js");
const { idFor } = require("./modules.js");

const changelog = fs.readFileSync(CHANGELOG_FILE, "utf8");
const parsed = releases(changelog);
if (!parsed.length) die("CHANGELOG.md 里没有任何版本小节。");
if (parsed[0].version !== target) {
  die(`CHANGELOG.md 顶部是 ${parsed[0].version}，不是 ${target}。新版本的小节要写在最上面。`);
}

const current = parsed[0];
const count = current.sections.reduce((n, s) => n + s.bullets.length, 0);
if (!count) die(`CHANGELOG.md 的 ${target} 小节是空的。写清这一版改了什么再发。`);

for (const section of current.sections) {
  if (section.module && !idFor(section.module)) {
    die(`CHANGELOG.md 的 ${target} 小节里有未知模块名「${section.module}」，见 tools/modules.js。`);
  }
}

console.log(`[发版] ${target} · ${count} 条说明${DRY ? "（dry-run，不落盘）" : ""}`);

// ---- 3. 写入版本号 ------------------------------------------------------

const date = today();
const stampedChangelog = changelog.replace(
  new RegExp(`^##\\s+v?${target.replace(/[.\\-]/g, "\\$&")}.*$`, "m"),
  `## ${target} · ${date}`
);

// dry-run 也要真的写进去再跑 verify：check.js 拿 version.json 的版本去 CHANGELOG
// 里找小节，不写的话预检看到的是上一个版本，等于没检查这一次要发的东西。
// 跑完原样还回去。
const before = {
  version: fs.readFileSync(VERSION_FILE, "utf8"),
  package: fs.readFileSync(PACKAGE_FILE, "utf8"),
  changelog,
};

const pkg = JSON.parse(before.package);
pkg.version = target;

fs.writeFileSync(VERSION_FILE, `${JSON.stringify({ version: target, released: date }, null, 2)}\n`, "utf8");
fs.writeFileSync(PACKAGE_FILE, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
fs.writeFileSync(CHANGELOG_FILE, stampedChangelog, "utf8");
console.log(`[写入] version.json · package.json · CHANGELOG.md 日期 ${date}`);

// ---- 4. 全量验证 --------------------------------------------------------

cleanup = () => {
  fs.writeFileSync(VERSION_FILE, before.version, "utf8");
  fs.writeFileSync(PACKAGE_FILE, before.package, "utf8");
  fs.writeFileSync(CHANGELOG_FILE, before.changelog, "utf8");
};

run("verify.js");

if (DRY) {
  cleanup();
  cleanup = null;
  console.log(`\ndry-run 通过，改动已还原。正式发版：node tools/release.js ${target}`);
  process.exit(0);
}

// ---- 5-6. 构建、部署、生成版本迭代.md -----------------------------------

run("build.js");
run("deploy.js");

// ---- 7. 提交并打 tag ----------------------------------------------------

const body = current.sections
  .map((s) => (s.module ? `${s.module}：` : "") + s.bullets.map((b) => `\n- ${b}`).join(""))
  .join("\n\n");

// add -A 而不是 commit -a：部署会生成 00 工作台/版本迭代.md，
// 第一次发版时它可能还是未跟踪文件，-a 收不到。
const staged = git("add", "-A");
if (staged.status !== 0) {
  console.error(staged.stdout || staged.stderr);
  die("git add 失败。");
}

const commit = git("commit", "-m", `release: ${target}`, "-m", body);
if (commit.status !== 0) {
  console.error(commit.stdout || commit.stderr);
  die("提交失败。改动仍在工作区，修好后重跑。");
}

// 已经提交了，此后再失败也不该把文件还原回去——那会和已提交的内容对不上。
cleanup = null;

const tag = git("tag", "-a", `v${target}`, "-m", `Learning OS ${target}`);
if (tag.status !== 0) {
  console.error(tag.stdout || tag.stderr);
  die(`已提交但打 tag 失败。手动补：git tag -a v${target} -m "Learning OS ${target}"`);
}

console.log(`\n[完成] ${target} 已提交并打 tag v${target}。`);
console.log(`回到 Obsidian 按 Ctrl+R。要退回这个版本：git checkout v${target} && node tools/deploy.js`);
