"use strict";

/**
 * CODEX 离线备份
 *
 * 全本地、不联网。把不可再生的 25MB 以两种格式写到**另一块物理磁盘**：
 *   1. git bundle —— 单文件，含完整历史，`git clone x.bundle` 即可还原；
 *   2. 明文镜像   —— 直接能用记事本打开的 .md，git 本身出问题时的最后一道保险。
 *
 * 课程文件/ 不备份：2.7GB 课件学校能重下，不值得占备份盘。
 *
 * 用法：
 *   node tools/backup.js              自动找可移动磁盘
 *   node tools/backup.js E:\          指定目标
 *   node tools/backup.js --list       只列出候选磁盘，不备份
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const KEEP_BUNDLES = 5;

// 不可再生的目录：自己写的笔记、代码、插件数据。课程文件/ 刻意排除。
const MIRROR = [
  "00 工作台", "01 收件箱", "02 项目", "03 知识库", "04 创作",
  "05 日记", "06 Codex", "07 归档", "08 插件开发", "99 模板",
  "版本管理", "附件", "book", ".obsidian",
];
const MIRROR_SKIP = new Set(["node_modules", "dist", "workspace.json", ".trash"]);

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: VAULT, encoding: "utf8", ...options }).trim();
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function bytes(n) {
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

/** vault 所在的物理磁盘号。备份写到同一块盘上等于没备份。 */
function diskOf(target) {
  const letter = path.resolve(target).slice(0, 1).toUpperCase();
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      `(Get-Partition -DriveLetter ${letter} -ErrorAction Stop).DiskNumber`],
      { encoding: "utf8" });
    return Number(out.trim());
  } catch {
    return null;
  }
}

function candidates() {
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command",
      "Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,DriveType,FileSystemLabel,SizeRemaining | ConvertTo-Json -Compress"],
      { encoding: "utf8" });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function copyTree(from, to) {
  let count = 0;
  let size = 0;
  const walk = (src, dest) => {
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (MIRROR_SKIP.has(entry.name)) continue;
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        walk(s, d);
      } else if (entry.isFile()) {
        fs.copyFileSync(s, d);
        count += 1;
        size += fs.statSync(s).size;
      }
    }
  };
  fs.mkdirSync(to, { recursive: true });
  walk(from, to);
  return { count, size };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list")) {
    const vaultDisk = diskOf(VAULT);
    console.log(`vault 在物理磁盘 ${vaultDisk}。备份必须写到别的磁盘号。\n`);
    for (const v of candidates()) {
      const disk = diskOf(`${v.DriveLetter}:\\`);
      const ok = disk !== null && disk !== vaultDisk;
      console.log(`  ${v.DriveLetter}:  磁盘 ${disk}  剩余 ${bytes(v.SizeRemaining)}  ${v.FileSystemLabel || ""}  ${ok ? "✓ 可用" : "✗ 与 vault 同盘"}`);
    }
    return;
  }

  const vaultDisk = diskOf(VAULT);
  let target = args.find((a) => !a.startsWith("--"));

  if (!target) {
    const found = candidates().find((v) => {
      const disk = diskOf(`${v.DriveLetter}:\\`);
      return disk !== null && disk !== vaultDisk;
    });
    if (!found) {
      console.error("没有找到与 vault 不同盘的目标。请插入 U 盘或移动硬盘，或用 node tools/backup.js <路径> 指定。");
      console.error("运行 node tools/backup.js --list 查看当前磁盘。");
      process.exitCode = 1;
      return;
    }
    target = `${found.DriveLetter}:\\`;
  }

  const targetDisk = diskOf(target);
  if (targetDisk !== null && targetDisk === vaultDisk) {
    console.error(`拒绝备份：目标 ${target} 和 vault 都在物理磁盘 ${vaultDisk} 上。`);
    console.error("同一块盘上的副本挡不住硬盘故障。请换一块物理设备。");
    process.exitCode = 1;
    return;
  }

  const dir = path.join(path.resolve(target), "CODEX专属-备份");
  fs.mkdirSync(dir, { recursive: true });
  console.log(`目标：${dir}（物理磁盘 ${targetDisk}，vault 在 ${vaultDisk}）\n`);

  // 1. 先把未提交的改动固化成一次提交，否则 bundle 里没有它们。
  const dirty = git(["status", "--porcelain"]);
  if (dirty) {
    const lines = dirty.split("\n").length;
    git(["add", "-A"]);
    git(["commit", "-q", "-m", `backup: 备份前快照 ${stamp()}（${lines} 处改动）`]);
    console.log(`[提交] ${lines} 处未提交改动已固化为一次提交。`);
  } else {
    console.log("[提交] 工作区干净，无需提交。");
  }

  // 2. bundle：一个文件装下整个历史。
  const bundle = path.join(dir, `CODEX专属-${stamp()}.bundle`);
  git(["bundle", "create", bundle, "--all"], { stdio: ["ignore", "ignore", "ignore"] });
  git(["bundle", "verify", bundle], { stdio: ["ignore", "ignore", "ignore"] });
  console.log(`[历史] ${path.basename(bundle)}  ${bytes(fs.statSync(bundle).size)}  已校验`);

  // 3. 明文镜像：git 出问题时还能直接读 .md。
  const mirror = path.join(dir, "明文镜像");
  fs.rmSync(mirror, { recursive: true, force: true });
  let files = 0;
  let size = 0;
  for (const name of MIRROR) {
    const src = path.join(VAULT, name);
    if (!fs.existsSync(src)) continue;
    const r = copyTree(src, path.join(mirror, name));
    files += r.count;
    size += r.size;
  }
  console.log(`[明文] ${files} 个文件  ${bytes(size)}  -> 明文镜像/`);

  // 4. 只留最近几份 bundle。
  const old = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".bundle"))
    .sort()
    .slice(0, -KEEP_BUNDLES);
  for (const f of old) fs.rmSync(path.join(dir, f));
  if (old.length) console.log(`[清理] 删除 ${old.length} 份旧 bundle，保留最近 ${KEEP_BUNDLES} 份。`);

  fs.writeFileSync(path.join(dir, "如何还原.txt"), [
    "CODEX专属 离线备份",
    "",
    `备份时间：${stamp()}`,
    "",
    "还原方式一（推荐，带完整历史）：",
    "  git clone CODEX专属-<时间>.bundle CODEX专属",
    "",
    "还原方式二（没有 git 时）：",
    "  直接复制「明文镜像」文件夹，里面是可以用记事本打开的 .md 笔记。",
    "",
    "本备份不含 课程文件/（2.7GB 课件，可从学校重新下载）。",
  ].join("\r\n"), "utf8");

  console.log("\n完成。备份盘可以拔下了。");
}

main();
