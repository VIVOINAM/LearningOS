"use strict";
/**
 * 本题卡检查：课堂笔记里的每一道题，阅读栏能不能取到它的题面和图。
 *
 *   node tools/check-problem-cards.cjs              # 全部课堂笔记
 *   NOTE_SHOTS="09-24 电工" node tools/check-problem-cards.cjs   # 文件名含这一段的
 *
 * 用的就是阅读栏自己的 reading-rail-model.js：这里取到什么，翻页读解答时右栏就显示什么。
 * - 取不到题面（错）：标题下紧跟一段，或写「**题目**：」「已知」「来源」开头的段落；解答写在它后面。
 * - 没有图（提示）：本题（含小节）没有图，也没借到点了本题编号的图、正文说到的「图 N」。
 *   纯计算题没有图是正常的；两道题共用一张图时，图的 alt 或图注要写全题号（「例 2.4 与例 2.5」）。
 */
const fs = require("node:fs"), path = require("node:path");
const M = require("../l-os-workbench/reading-rail-model");

const vault = path.resolve(__dirname, "../..");
const root = path.join(vault, "03 知识库/我的课程");
const filter = (process.env.NOTE_SHOTS || "").normalize("NFC");

function notes(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!/^(_assets|assets|附件)$/.test(entry.name)) out.push(...notes(full)); }
    else if (entry.name.endsWith(".md") && full.includes(`${path.sep}课堂笔记${path.sep}`)) out.push(full);
  }
  return out;
}

let errors = 0, problems = 0, bare = 0;
for (const file of notes(root).sort()) {
  const name = path.relative(vault, file).replace(/\\/g, "/");
  if (filter && !name.normalize("NFC").includes(filter)) continue;
  const doc = M.scan(fs.readFileSync(file, "utf8"));
  const lines = [];
  doc.headings.forEach((h, i) => {
    if (!M.isProblem(doc, i)) return;
    problems++;
    const card = M.problemCard(doc, i);
    const text = card?.items.some((item) => item.kind === "text"), figure = card?.items.some((item) => item.kind === "figure");
    if (!text) { errors++; lines.push(`  ✖ 第 ${h.line + 1} 行「${h.heading}」取不到题面`); }
    if (!figure) { bare++; lines.push(`  · 第 ${h.line + 1} 行「${h.heading}」没有图`); }
  });
  if (lines.length) console.log(`${name}\n${lines.join("\n")}`);
}
console.log(`本题卡：${problems} 道题，${errors} 道取不到题面，${bare} 道没有图。`);
if (errors) process.exitCode = 1;
