"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const M = require("../own-books-model.js");

const VAULT = path.resolve(__dirname, "../../..");

test("系列、书、字段与系列缺省值", () => {
  const series = M.parseRegistry(`---
type: own-books
---
# 自编教材

- 状态：这一行在任何系列之前，不算数

## 数学体系
- 计划：[[book/README]]
- 下一步：跨卷引用重指

### 卷1·代数
- 状态：已完成
- PDF：[[book/卷1·代数.pdf|卷一]]
- 页数：336

### 卷13·新卷
- 状态：编写中
- 计划：[[02 项目/写卷十三]]
- 进度：3 / 12 章
- 页数：120/200

\`\`\`
### 代码块里的标题不是书
\`\`\`
`);
  assert.equal(series.length, 1);
  const [g] = series;
  assert.equal(g.name, "数学体系");
  assert.equal(g.next, "跨卷引用重指");
  assert.equal(g.books.length, 2);
  const [a, b] = g.books;
  assert.equal(a.pdf, "book/卷1·代数.pdf");
  assert.equal(a.plan, "book/README", "系列的计划是每本书的缺省值");
  assert.equal(a.next, "", "系列的下一步不抄给每本书");
  assert.deepEqual(a.pages, {done:336, total:0, unit:""});
  assert.equal(b.plan, "02 项目/写卷十三", "书自己写的计划盖过系列缺省值");
  assert.deepEqual(b.progress, {done:3, total:12, unit:"章"});
  assert.equal(M.completion(b), 0.25);
});

test("没写的状态和下一步跟着计划笔记走；已完成没有进度也算满", () => {
  const series = M.parseRegistry("## 课程手册\n### 手册\n- 计划：[[02 项目/写手册]]\n### 另一本\n- 状态：已完成\n");
  const groups = M.buildShelf({
    series,
    resolve: link => link === "02 项目/写手册" ? "02 项目/写手册.md" : "",
    plan: p => p === "02 项目/写手册.md" ? {status:"进行中", next:"写第三篇", due:"2026-10-10"} : null,
  });
  const [draft, done] = groups[0].books;
  assert.equal(draft.status, "编写中");
  assert.equal(draft.next, "写第三篇");
  assert.equal(draft.due, "2026-10-10");
  assert.equal(draft.done, null, "不知道写到哪就不给完成度，不画假的进度条");
  assert.equal(done.done, 1);
});

test("book/ 里没登记的 PDF 归进「未登记」，登记了但找不到的标出来", () => {
  const series = M.parseRegistry("## 系列\n### 甲\n- PDF：book/甲.pdf\n### 乙\n- PDF：book/乙.pdf\n");
  const pdfs = ["book/甲.pdf", "book/丙.pdf", "课程文件/别人的书.pdf"];
  const groups = M.buildShelf({series, pdfs, resolve: p => pdfs.includes(p) ? p : ""});
  assert.equal(groups[0].books[1].missingPdf, true);
  const stray = groups.find(g => g.stray);
  assert.deepEqual(stray.books.map(b => b.pdf), ["book/丙.pdf"], "只收 book/ 下的，别人的教材不算自编");
  assert.match(M.shelfSummary(groups), /^3 本/);
});

test("库里真实的登记表：book/ 每份 PDF 都登记了，MATLAB 手册挂着它的编写计划", () => {
  const text = fs.readFileSync(path.join(VAULT, M.REGISTRY), "utf8");
  const pdfs = fs.readdirSync(path.join(VAULT, "book")).filter(n => n.endsWith(".pdf")).map(n => "book/" + n.normalize("NFC"));
  const exists = p => fs.existsSync(path.join(VAULT, p));
  const resolve = link => [link, link + ".md", link + ".pdf"].find(exists) || "";
  const groups = M.buildShelf({series: M.parseRegistry(text), pdfs, resolve});
  assert.ok(!groups.some(g => g.stray), "有 PDF 没登记：" + JSON.stringify(groups.filter(g => g.stray).flatMap(g => g.books.map(b => b.pdf))));
  const books = groups.flatMap(g => g.books);
  assert.deepEqual(books.filter(b => b.missingPdf).map(b => b.title), [], "登记的 PDF 都要在库里");
  const matlab = books.find(b => b.title.includes("MATLAB"));
  assert.equal(matlab.planPath, "02 项目/编写化工过程计算MATLAB手册.md");
  assert.deepEqual(matlab.pages, {done:197, total:200, unit:""});
  // 计划中的书还没有 PDF（静力学下册），不算进一一对应。
  assert.equal(books.filter(b => b.pdf).length, pdfs.length);
});
