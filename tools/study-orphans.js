"use strict";

/**
 * 教材切片孤儿检测。
 *
 * 区域截取会把 PNG 写进「03 知识库/教材切片」，文件名带 32 位随机十六进制。
 * 如果元数据里没有对应批注、笔记里也没粘贴过链接，这张图就永远找不回来了——
 * 5.2 起「复制双链引用」正是这么丢失了 4 张切片。
 *
 * 用法：node tools/study-orphans.js [--json]
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const VAULT = path.resolve(ROOT, "..");
const CROPS = path.join(VAULT, "03 知识库", "教材切片");
const META = path.join(CROPS, "学习元数据.json");
const JSON_OUT = process.argv.includes("--json");

function referencedInMetadata() {
  const refs = new Set();
  if (!fs.existsSync(META)) return refs;
  let data;
  try { data = JSON.parse(fs.readFileSync(META, "utf8")); }
  catch (error) { console.error(`[错误] 学习元数据无法解析：${error.message}`); return refs; }
  for (const record of Object.values(data?.study?.records || {})) {
    for (const annotation of record?.annotations || []) {
      if (annotation?.imagePath) refs.add(path.basename(annotation.imagePath));
    }
  }
  return refs;
}

/** 笔记里手工粘贴的 ![[...png]] 也算有归属。 */
function referencedInNotes() {
  const refs = new Set();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!entry.name.startsWith(".")) walk(full); continue; }
      if (!entry.name.endsWith(".md")) continue;
      const text = fs.readFileSync(full, "utf8");
      for (const m of text.matchAll(/教材切片\/([^\]\)|#]+\.png)/g)) refs.add(decodeURIComponent(m[1]));
    }
  };
  for (const top of ["03 知识库", "02 项目", "05 日记", "01 收件箱", "04 创作"]) {
    const dir = path.join(VAULT, top);
    if (fs.existsSync(dir)) walk(dir);
  }
  return refs;
}

if (!fs.existsSync(CROPS)) {
  console.log("没有 教材切片 目录，跳过。");
  return;
}

const files = fs.readdirSync(CROPS).filter(n => n.toLowerCase().endsWith(".png"));
const meta = referencedInMetadata();
const notes = referencedInNotes();
const orphans = files.filter(n => !meta.has(n) && !notes.has(n));

if (JSON_OUT) {
  console.log(JSON.stringify({ total: files.length, inMetadata: meta.size, inNotes: notes.size, orphans }, null, 2));
} else {
  console.log(`切片图片 ${files.length} 张 · 元数据引用 ${meta.size} · 笔记引用 ${notes.size}`);
  if (!orphans.length) console.log("没有孤立切片。");
  else {
    console.log(`\n[孤立] ${orphans.length} 张图片没有任何引用，界面上再也看不到：`);
    for (const name of orphans) {
      const m = name.match(/^(.*)_p(\d+)_crop_[0-9a-f]+\.png$/);
      console.log(`  ${name}${m ? `   （来自《${m[1]}》第 ${m[2]} 页）` : ""}`);
    }
  }
}
process.exitCode = orphans.length ? 1 : 0;
