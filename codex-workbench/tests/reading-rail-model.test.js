"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../reading-rail-model");

const NOTE = [
  "---",                                   // 0
  "type: class-note",                      // 1
  "---",                                   // 2
  "# 流体力学 · 9 月 22 日",                // 3
  "",                                      // 4
  "## 课堂记录",                            // 5
  "",                                      // 6
  "#### 例 2：带回流的分流网络",             // 7
  "",                                      // 8
  "![例 2 原题流程图](_assets/例2.png)",     // 9
  "",                                      // 10
  "先顺着箭头走一圈。",                      // 11
  "第二行同一段。",                          // 12
  "",                                      // 13
  "$$",                                    // 14
  "\\dot m_1 + \\dot m_5",                  // 15
  "",                                      // 16
  "= \\dot m_2",                            // 17
  "$$",                                    // 18
  "",                                      // 19
  "| 流股 | 比例 |",                        // 20
  "|---|---|",                             // 21
  "| 3 | 30% |",                           // 22
  "",                                      // 23
  "#### 例 3：萃取",                        // 24
  "",                                      // 25
  "```python",                             // 26
  "# 不是标题",                             // 27
  "![[假图.png]]",                          // 28
  "```",                                   // 29
  "![[例3.svg|400]]",                       // 30
  "推导……",                                 // 31
  "## 课后总结",                            // 32
].join("\n");

test("只接管课堂笔记，附件目录不算", () => {
  assert.ok(M.eligible({ extension: "md", path: "课程/课堂笔记/电工学/今天.md" }));
  assert.ok(!M.eligible({ extension: "md", path: "课程/课程主页.md" }));
  assert.ok(!M.eligible({ extension: "pdf", path: "课程/课堂笔记/书.pdf" }));
  assert.ok(!M.eligible({ extension: "md", path: "课程/课堂笔记/电工学/_assets/说明.md" }));
});

test("栏宽夹在 260–560，缺省 340", () => {
  assert.equal(M.railWidth(-1), 260);
  assert.equal(M.railWidth(900), 560);
  assert.equal(M.railWidth(null), 340);
  assert.equal(M.railWidth("401.6"), 402);
});

test("块定位：围栏整块、连续非空行、标题停、frontmatter 不给钉", () => {
  assert.equal(M.blockAt(NOTE, 16).markdown, "$$\n\\dot m_1 + \\dot m_5\n\n= \\dot m_2\n$$");
  assert.deepEqual([M.blockAt(NOTE, 12).start, M.blockAt(NOTE, 12).end], [11, 12]);
  assert.equal(M.blockAt(NOTE, 21).markdown.split("\n").length, 3);
  assert.equal(M.blockAt(NOTE, 7).markdown, "#### 例 2：带回流的分流网络");
  assert.equal(M.blockAt(NOTE, 31).markdown, "![[例3.svg|400]]\n推导……");
  assert.equal(M.blockAt(NOTE, 1), null);
  assert.equal(M.blockAt(NOTE, 13), null);
  assert.equal(M.blockAt("> [!tip] 顺序\n> 先画边界\n\n下一段", 1).markdown, "> [!tip] 顺序\n> 先画边界");
  // 单行 $$x$$ 不是围栏，不能把后面整篇吞进去。
  assert.equal(M.blockAt("$$x$$\n\n正文", 2).markdown, "正文");
});

test("扫描：代码块里的 # 和图片不算，非图片嵌入不算", () => {
  const doc = M.scan(NOTE);
  assert.deepEqual(doc.headings.map((h) => [h.line, h.level]), [[3, 1], [5, 2], [7, 4], [24, 4], [32, 2]]);
  assert.deepEqual(doc.figures.map((f) => [f.line, f.link, f.section.line]), [[9, "_assets/例2.png", 7], [30, "例3.svg", 24]]);
  assert.equal(M.imageIn("![[讲义.pdf#page=3]]"), null);
  assert.equal(M.imageIn("见 ![[笔记]]"), null);
  assert.equal(M.imageIn("![](https://x.org/a.png?w=2)").link, "https://x.org/a.png?w=2");
  assert.equal(M.imageIn("![图](<有 空格.png>)").link, "有 空格.png");
});

test("题图跟随：滚过才出现，本节读完就收", () => {
  const doc = M.scan(NOTE);
  assert.equal(M.figureFor(doc, 8), null, "图还没到");
  assert.equal(M.figureFor(doc, 9), null, "图正贴在屏幕顶上，还看得见");
  assert.equal(M.figureFor(doc, 10).line, 9);
  assert.equal(M.figureFor(doc, 23).line, 9);
  assert.equal(M.figureFor(doc, 24), null, "进了例 3，例 2 的图收掉");
  assert.equal(M.figureFor(doc, 31).line, 30);
  assert.equal(M.figureFor(doc, 32), null, "更高一级的标题也收");
  assert.equal(M.figureFor(doc, NaN), null);
});

test("当前章节按屏幕顶上那一行算", () => {
  const { headings } = M.scan(NOTE);
  assert.equal(M.activeIndex(headings, 0), 0);
  assert.equal(M.activeIndex(headings, 7), 2);
  assert.equal(M.activeIndex(headings, 6.6), 2, "刚贴顶的标题算读到");
  assert.equal(M.activeIndex(headings, 30), 3);
  assert.equal(M.activeIndex([], 3), -1);
});

test("目录：唯一的 H1 是标题不进目录，最浅一级顶格，折叠藏子项", () => {
  const { headings } = M.scan(NOTE);
  const { rows, title } = M.outlineRows(headings);
  assert.equal(title, 0);
  assert.deepEqual(rows.map((r) => [r.heading.slice(0, 4), r.depth, r.parent]), [["课堂记录", 0, true], ["例 2：", 2, false], ["例 3：", 2, false], ["课后总结", 0, false]]);
  const folded = M.outlineRows(headings, new Set([1])).rows;
  assert.deepEqual(folded.map((r) => r.index), [1, 4]);
  assert.ok(folded[0].folded);
  // 两个 H1 时它们都是章节，不是标题。
  const two = M.outlineRows([{ heading: "上", level: 1, line: 0 }, { heading: "下", level: 1, line: 5 }]);
  assert.equal(two.title, -1);
  assert.equal(two.rows.length, 2);
});

test("钉住的内容：去空白、限长、标签截断", () => {
  assert.deepEqual(M.pinValue(" ![[图.png]] ", "图片", 9), { markdown: "![[图.png]]", label: "图片", line: 9 });
  assert.throws(() => M.pinValue("", ""));
  assert.throws(() => M.pinValue("a".repeat(20001), ""));
  assert.equal(M.pinValue("x", "长".repeat(100)).label.length, 80);
});
