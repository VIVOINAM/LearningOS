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

test("本节的图：直属的图；自己没有就找最近的上级；默认看滚过的最后一张", () => {
  const doc = M.scan(NOTE);
  assert.deepEqual(M.sectionFigures(doc, 2).map((f) => f.line), [9]);
  assert.deepEqual(M.sectionFigures(doc, 3).map((f) => f.line), [30]);
  assert.deepEqual(M.sectionFigures(doc, 1), [], "「课堂记录」直属没有图，不把小节的图收上来");
  assert.deepEqual(M.sectionFigures(doc, 4), []);
  const nested = M.scan(["## 第 2 章", "![[控制体.png]]", "### 2.1", "正文", "### 2.2", "![a](a.png)", "![b](b.png)"].join("\n"));
  assert.deepEqual(M.sectionFigures(nested, 1).map((f) => f.link), ["控制体.png"], "2.1 没图，看上级第 2 章的");
  assert.deepEqual(M.sectionFigures(nested, 2).map((f) => f.link), ["a.png", "b.png"]);
  const two = M.sectionFigures(nested, 2);
  assert.equal(M.pickFigure(two, 5), 0, "都还没滚过：第一张");
  assert.equal(M.pickFigure(two, 5.5), 0);
  assert.equal(M.pickFigure(two, 6.2), 1, "b 滚过了屏幕顶");
  assert.equal(M.pickFigure([], 3), -1);
  assert.deepEqual(M.sectionFigures(M.scan("![[封面.png]]\n正文"), -1).map((f) => f.line), [0], "没有标题的笔记");
});

// 静力学习题课的写法：图在前，**题目** 在后；两道题共用一张图，图放在前一道题下面。
const STATICS = [
  "## 课堂记录",                                        // 0
  "### 2 · 例题逐题解析",                                // 1
  "#### 2.4 已知水平分量，反求斜向力",                    // 2
  "",
  "![例 2.4 与例 2.5](_assets/2.4-2.5.svg)",             // 4
  "",
  "**题目**：已知水平分量 1200 N，求 $P_{CB}$。",          // 6
  "",
  "**思路**：一个分量已知。",                             // 8
  "",
  "$$", "P=1464.9", "$$",                               // 10–12
  "",
  "#### 2.5 B 点三个力按分量合成",                         // 14
  "",
  "**题目**：缆 BC 的拉力为 725 N，求合力。",              // 16
  "",
  "| 力 | Fx |", "|---|---|", "| T | -525 |",           // 18–20
  "",
  "#### 2.6 两根缆",                                     // 22
  "",
  "> 本题数值为说明方法而设。",                            // 24
  "",
  "A、B 两点相距 600 mm，求拉力。",                        // 26
  "",
  "第一步：写分量。",                                     // 28
  "",
  "##### 解",                                            // 30
  "",
  "![力多边形](_assets/2.6-b.svg)",                       // 32
  "",
  "上图是闭合的力多边形。",                                // 34
  "",
  "### 3 · 数目够，不等于挡得住",                          // 36
  "",
  "下图 (a)(b) 都是 $v=3$ 却可动。",                       // 38
  "",
  "![反力线平行或穿过铰](_assets/02a.svg)",               // 40
  "",
  "中间一段。",                                           // 42
  "",
  "![反力线共点](_assets/02b.svg)",                       // 44
  "*图 2｜三根连杆交于 O。*",                              // 45
].join("\n");

// 电工学习题课的写法：来源和数值在图前，斜体图注在图后，题面之后直接是解答。
const CIRCUITS = [
  "### 2. 等效电阻",                                     // 0
  "#### 例 1：两路先串联",                                // 1
  "",
  "来源：p.1。已知 $R_1=1\\,\\Omega$，求 $R_{ab}$。",       // 3
  "",
  "![例1：原电路](a/01.svg)",                            // 5
  "",
  "*图 1｜节点 $a$ 到 $n$ 有两条支路。*",                   // 7
  "",
  "左路、右路分别为：",                                    // 9
  "",
  "#### 例题：四个电压源的代数和",                          // 11
  "",
  "![单回路](a/08.svg)",                                  // 13
  "",
  "*图 8｜$i$ 向左。*",                                    // 15
  "",
  "已知 $R_1=1\\,\\Omega$，$V_{s1}=3\\,\\mathrm V$：",       // 17
  "",
  "- $V_{s2}=6$",                                        // 19
  "",
  "**第一步：确定电流。** 与图 1 的做法相同。",               // 21
  "",
  "### 习题课 E01：宏观物料衡算（例 2、3、5）",              // 23
  "",
  "![[总流程.png]]",                                      // 25
].join("\n");

test("认题：例 / 例题 / 巩固题 / 带「题目」段的小节；习题课、例题逐题解析是容器", () => {
  const s = M.scan(STATICS), c = M.scan(CIRCUITS);
  const problems = (doc) => doc.headings.map((h, i) => M.isProblem(doc, i) && h.heading.slice(0, 6)).filter(Boolean);
  assert.deepEqual(problems(s), ["2.4 已知", "2.5 B "], "2.6 没有「题目」也不叫例：不算题");
  assert.deepEqual(problems(c), ["例 1：两路", "例题：四个电"]);
  const t = (heading) => M.isProblem(M.scan(`## ${heading}`), 0);
  assert.ok(t("6 · 例题：三铰刚架受一个竖向力") && t("6. 巩固题 A：单回路") && t("Esercizio 2") && t("例 3：萃取"));
  assert.ok(!t("2 · 例题逐题解析") && !t("习题课 E01：宏观物料衡算") && !t("本段对应的练习") && !t("课后总结"));
});

test("本题卡：图 + 题面，碰到解答就停；图注跟着图", () => {
  const s = M.scan(STATICS);
  const c24 = M.card(s, 2, 3);
  assert.equal(c24.kind, "problem");
  assert.deepEqual(c24.items.map((i) => [i.kind, i.line]), [["figure", 4], ["text", 6]], "「思路」和公式是解答，不进题面");
  const c = M.scan(CIRCUITS), e1 = M.card(c, 1, 2);
  assert.deepEqual(e1.items.map((i) => [i.kind, i.line]), [["text", 3], ["figure", 5]], "来源段在图前，「左路、右路」是解答");
  assert.equal(e1.items[1].caption, "*图 1｜节点 $a$ 到 $n$ 有两条支路。*");
  const e2 = M.card(c, 2, 12);
  assert.deepEqual(e2.items.map((i) => [i.kind, i.line]), [["figure", 5], ["figure", 13], ["text", 17], ["text", 19]],
    "正文说到「图 1」：把例 1 的图借来；「已知……：」后面的列表是题面的一部分");
  assert.equal(e2.markdown.split("\n\n")[0], "![例1：原电路](a/01.svg)", "拼起来的源码按卡里的顺序");
  // 9-22 静力学、流体的写法：图在最前，下面一段没有标签的题面；「图中……」散文讲的是题给数据，按题面排。
  const early = M.scan([
    "#### 例 4：两根绳吊起重物", "", "![[例4.png]]", "", "重物 736 N 挂在 A 点，求两根绳的拉力。", "",
    "**第一步：隔离 A 点。**", "",
    "#### 例 2：分流网络", "", "![例 2 流程图](e2.png)", "", "图中数字是**流股编号**。已知 $\\dot m_1=100$；求各流股。", "",
    "**先用手指沿箭头走一圈。**", "",
    "#### 2.5 空间里的力", "", "**题目最常见的给法是：力的大小加两点。**",
  ].join("\n"));
  assert.deepEqual(M.card(early, 0, 1).items.map((i) => [i.kind, i.line]), [["figure", 2], ["text", 4]], "图后第一段是题面，「**第一步**」不是");
  const flow = M.card(early, 1, 9);
  assert.deepEqual(flow.items.map((i) => [i.kind, i.line, i.caption || ""]), [["figure", 10, ""], ["text", 12, ""]], "散文图注进题面，不当灰字图注");
  assert.equal(M.isProblem(early, 2), false, "「题目最常见的给法」是讲解");
});

test("本题卡：两道题共用一张图时，后一道借用点了它题号的图；读到题的小节也是这道题", () => {
  const s = M.scan(STATICS);
  const c25 = M.card(s, 3, 15);
  assert.deepEqual(c25.items.map((i) => [i.kind, i.line]), [["figure", 4], ["text", 16]], "2.5 自己没图：用「例 2.4 与例 2.5」");
  assert.equal(c25.items[0].lead, "", "借来的图不带别的题的引导语");
  assert.equal(c25.line, 14, "回到原文回到题目标题");
  // 2.6 不是题（没有题目段、标题不叫例），它的「解」小节就是普通小节：用自己的图。
  assert.equal(M.card(s, 5, 31).kind, "section");
  // 同样的结构，标题改叫「例 2.6」：读到「解」时卡片是整道题——题面（跳过开头的提示框）+ 解里的图。
  const named = M.scan(STATICS.replace("#### 2.6 两根缆", "#### 例 2.6 两根缆"));
  const solve = M.card(named, 5, 33);
  assert.equal(solve.kind, "problem");
  assert.equal(solve.heading, "例 2.6 两根缆");
  assert.deepEqual(solve.items.map((i) => [i.kind, i.line]), [["text", 26], ["figure", 32]], "提示框跳过；「第一步」是解答");
  assert.equal(solve.items[1].lead, "上图是闭合的力多边形。");
  assert.equal(M.problemAt(named, 34).heading, "例 2.6 两根缆", "钉题里的图：整道题");
  assert.equal(M.problemAt(named, 40), null);
});

test("本节题图：每张图带图注和引导语，当前那张是滚过的最后一张", () => {
  const s = M.scan(STATICS);
  const sec = M.card(s, 6, 37);
  assert.equal(sec.kind, "section");
  assert.deepEqual(sec.items.map((i) => [i.line, i.lead, i.caption]), [[40, "下图 (a)(b) 都是 $v=3$ 却可动。", ""], [44, "", "*图 2｜三根连杆交于 O。*"]]);
  assert.equal(sec.current, 0);
  assert.equal(M.card(s, 6, 44.5).current, 1);
  assert.equal(M.card(s, 6, 44.5).line, 44, "回到原文回到当前那张图");
  assert.equal(M.card(s, 0, 0), null, "「课堂记录」自己没有图");
  assert.equal(M.itemMarkdown(sec.items[1]), "![反力线共点](_assets/02b.svg)\n\n*图 2｜三根连杆交于 O。*");
  assert.equal(M.itemMarkdown(sec.items[0]), "![反力线平行或穿过铰](_assets/02a.svg)\n\n下图 (a)(b) 都是 $v=3$ 却可动。");
});

test("图的说明：alt 取来当图注，wiki 链接里的尺寸不算", () => {
  assert.equal(M.imageIn("![四种平衡状态](_assets/p31.png)").alt, "四种平衡状态");
  assert.equal(M.imageIn("![[例3.svg|400]]").alt, "");
  assert.equal(M.imageIn("![[例3.svg|萃取流程]]").alt, "萃取流程");
  assert.equal(M.imageIn("![流程|300](a.png)").alt, "流程");
});

test("页码拆成徽标：只拆结尾那对括号", () => {
  assert.deepEqual(M.pageOf("第 1 章　引言：系统与压力（p.3–5）"), { title: "第 1 章　引言：系统与压力", page: "p.3–5" });
  assert.deepEqual(M.pageOf("2.1 总质量衡算（p.7）"), { title: "2.1 总质量衡算", page: "p.7" });
  assert.deepEqual(M.pageOf("斯蒂文定律（Legge di Stevin，p.22–24）"), { title: "斯蒂文定律（Legge di Stevin）", page: "p.22–24" });
  assert.deepEqual(M.pageOf("4.2 静水总压力 (spinte, p. 26-30)"), { title: "4.2 静水总压力 (spinte)", page: "p.26–30" });
  assert.deepEqual(M.pageOf("例 2：带回流的分流网络（原讲义 Esercizio 2，PDF 第 4–5 页）"), { title: "例 2：带回流的分流网络（原讲义 Esercizio 2）", page: "p.4–5" });
  assert.deepEqual(M.pageOf("讲义 p.1–32：衡算方程、流体性质"), { title: "讲义 p.1–32：衡算方程、流体性质", page: "" });
  assert.deepEqual(M.pageOf("课后总结（重点）"), { title: "课后总结（重点）", page: "" });
  assert.deepEqual(M.pageOf("(p.3)"), { title: "(p.3)", page: "" }, "整个标题就是页码时不拆空");
});

test("手风琴：只展开读到的那条链，手动的听手动的", () => {
  const hs = [["课堂记录", 2], ["讲义", 3], ["第 1 章", 4], ["1.1", 5], ["第 2 章", 4], ["2.1", 5], ["2.1.1", 6], ["2.2", 5], ["2.2.1", 6], ["课后总结", 2]]
    .map(([heading, level], line) => ({ heading, level, line }));
  assert.deepEqual([...M.chainOf(hs, 5)], [5, 4, 1, 0]);
  assert.deepEqual([...M.foldedSet(hs, 5)], [2, 7], "第 1 章收起；第 2 章展开，它下面没读到的 2.2 收起，读到的 2.1 展开");
  assert.deepEqual([...M.foldedSet(hs, 5, new Map([[2, false], [5, true]]))], [5, 7]);
  assert.deepEqual([...M.foldedSet(hs, 5, new Map(), true)], [], "全部展开");
  assert.deepEqual([...M.foldedSet(hs, -1)], [], "篇首还没进任何一章：全展开");
  assert.deepEqual([...M.foldedSet(hs, 1)], [], "在「讲义」开头：各章都展开，看得到全貌");
  assert.deepEqual([...M.foldedSet(hs, 2)], [4], "进了第 1 章：第 2 章收起");
});

test("栏的摆法按笔记这一格的宽度：三列、目录加一列、抽屉", () => {
  assert.equal(M.layoutMode(0), "stack");
  assert.equal(M.layoutMode(850), "compact");
  assert.equal(M.layoutMode(1100), "stack");
  assert.equal(M.layoutMode(1180), "three");
  assert.equal(M.navWidth(null), 260);
  assert.equal(M.navWidth(100), 200);
  assert.equal(M.navWidth(900), 420);
  assert.equal(M.figWidth(null, 1556, 260), 456, "没拖过：正文一行 760 之外的白边归题图");
  assert.equal(M.figWidth(null, 1180, 260), 360, "自动也不许把正文挤到 560 以下");
  assert.equal(M.figWidth(null, 2400, 260), 640);
  assert.equal(M.figWidth(380, 1556, 260), 380, "拖过的听拖的");
  assert.equal(M.figWidth(2000), 640);
  assert.equal(M.figWidth(380, 1180, 260), 360, "正文至少留 560");
  assert.equal(M.figWidth(380, 1000, 260), 300, "再挤也给题图 300");
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
