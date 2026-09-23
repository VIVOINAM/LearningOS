"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../class-notes");

const COURSE = { id: "060112", title: "化工过程计算" };

test("路径：文件夹「代码 中文名」，文件名日期开头，能认回去", () => {
  assert.equal(m.folderOf(COURSE), "03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算");
  const path = m.notePath(COURSE, "2026-09-22");
  assert.equal(path, "03 知识库/我的课程/2026-27/课堂笔记/060112 化工过程计算/2026-09-22 化工过程计算.md");
  assert.deepEqual(m.parseNotePath(path), { course: COURSE, key: "2026-09-22" });
  assert.equal(m.isClassNote("03 知识库/我的课程/2026-27/060112 化工过程计算.md"), false);
  assert.equal(m.isClassNote(`${m.folderOf(COURSE)}/附件/2026-09-22 化工过程计算 101530.png`), false);
  assert.equal(m.attachmentFolder(COURSE), `${m.folderOf(COURSE)}/附件`);
});

test("课名里的斜杠不会把路径切开", () => {
  assert.match(m.notePath({ id: "000001", title: "A/B" }, "2026-09-22"), /\/000001 A／B\/2026-09-22 A／B\.md$/);
});

test("模板：日期写进 frontmatter、标题和第一行，不预填内容", () => {
  const text = m.noteTemplate({
    course: COURSE, key: "2026-09-22",
    sessions: [{ start: "08:15", end: "10:15", room: "9.0.1", address: "Piazza Leonardo da Vinci 32" }],
    coursePath: "03 知识库/我的课程/2026-27/060112 化工过程计算.md",
  });
  assert.match(text, /^---\ntype: class-note\ncourse: "060112"\n/);
  assert.match(text, /\ndate: 2026-09-22\n/);
  assert.match(text, /\ncssclasses:\n  - class-note\n---\n/);
  assert.match(text, /\n# 化工过程计算 · 9 月 22 日（周二）\n/);
  assert.match(text, /\n08:15–10:15 · 9\.0\.1 · Piazza Leonardo da Vinci 32 · \[\[03 知识库\/我的课程\/2026-27\/060112 化工过程计算\|课程主页\]\]\n/);
  assert.match(text, /## 课堂记录\n\n\n## 课后总结\n/);
});

test("任务：统一标题、P2、一个番茄、按标签去重", () => {
  const spec = m.taskSpec(COURSE, "2026-09-22");
  assert.deepEqual(spec, {
    title: "总结笔记 · 化工过程计算 · 09-22",
    category: "课堂笔记",
    priority_level: "P2",
    estimated_pomodoros: 1,
    scheduled: "2026-09-22",
    tags: "课堂笔记/2026-09-22/060112",
    references: m.notePath(COURSE, "2026-09-22"),
  });
  assert.equal(m.courseOfTask({ tags: spec.tags }), "060112");
  assert.equal(m.courseOfTask({ tags: "别的, 课堂笔记/2026-09-22/060112" }), "060112");
  assert.equal(m.courseOfTask({ tags: "" }), "");
  assert.equal(m.hasTaskTag({ tags: spec.tags }, m.taskTag("2026-09-22", "060112")), true);
  assert.equal(m.hasTaskTag({ tags: spec.tags }, m.taskTag("2026-09-23", "060112")), false);
});

test("今天的课按课程归并：一天两节的课只算一门", () => {
  const slot = (id, start) => ({ slot: { course: { id, title: id }, start } });
  const out = m.todayCourses([slot("A", "08:15"), slot("B", "10:15"), slot("A", "14:15")]);
  assert.deepEqual(out.map((x) => [x.course.id, x.sessions.length]), [["A", 2], ["B", 1]]);
});

test("公式：\\( \\) 与 \\[ \\] 改成 $ 与 $$", () => {
  assert.equal(m.normalizeMath("设 \\( x^2 \\) 为"), "设 $x^2$ 为");
  assert.equal(m.normalizeMath("能量守恒\\[ E = mc^2 \\]由此"), "能量守恒\n\n$$\nE = mc^2\n$$\n\n由此");
  assert.equal(m.normalizeMath("\\[a\\]"), "$$\na\n$$");
});

test("公式：光着的 align 包进 $$，已包过的不再包", () => {
  const bare = "\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}";
  assert.equal(m.normalizeMath(bare), `$$\n${bare}\n$$`);
  assert.equal(m.normalizeMath(`$$\n${bare}\n$$`), `$$\n${bare}\n$$`);
  assert.equal(m.normalizeMath(`\\[\n${bare}\n\\]`), `$$\n${bare}\n$$`);
  // aligned 是块内环境，只能出现在公式里面，光着出现也不该被当成独立公式乱包。
  assert.equal(m.normalizeMath("\\begin{aligned}x\\end{aligned}"), "\\begin{aligned}x\\end{aligned}");
});

test("公式：\\\\[4pt] 是换行加间距，不是 \\[", () => {
  const text = "$$\n\\begin{cases} x \\\\[4pt] y \\end{cases}\n$$";
  assert.equal(m.normalizeMath(text), text);
  assert.equal(m.normalizeMath("a \\\\[4pt] b"), "a \\\\[4pt] b");
});

test("公式：代码块、行内代码原样保留", () => {
  const code = "```latex\n\\[ x \\]\n```";
  assert.equal(m.normalizeMath(code), code);
  assert.equal(m.normalizeMath("写成 `\\(x\\)` 就行"), "写成 `\\(x\\)` 就行");
});

test("公式：$ x^2 $ 收掉内侧空格，价钱不动", () => {
  assert.equal(m.normalizeMath("有 $ x^2 $ 项"), "有 $x^2$ 项");
  assert.equal(m.normalizeMath("花了 $5 和 $6"), "花了 $5 和 $6");
  assert.equal(m.normalizeMath("没有公式的一段话"), "没有公式的一段话");
});

test("图片名：日期 课名 时分秒", () => {
  assert.equal(m.imageName(COURSE, "2026-09-22", new Date(2026, 8, 22, 9, 5, 7), "jpg"), "2026-09-22 化工过程计算 090507.jpg");
});
