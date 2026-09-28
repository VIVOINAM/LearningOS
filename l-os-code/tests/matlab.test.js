"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const core = require("../core/matlab");

const kinds = line => line.tokens.filter(t => t.t !== "text").map(t => [t.t, t.v]);
const one = src => core.highlight(src)[0];

test("转置和字符串：紧贴在名字、数字、右括号后面的 ' 是转置", () => {
  assert.deepEqual(kinds(one("x = A'; s = 'abc';")), [["str", "'abc'"]]);
  assert.deepEqual(kinds(one("y = (a+b)' * c.';")), []);
  assert.deepEqual(kinds(one("z = x'';")), [], "连续转置");
  assert.deepEqual(kinds(one("v = [a 'b'];")), [["str", "'b'"]], "空格隔开时是字符串");
  assert.deepEqual(kinds(one("disp('it''s')")), [["str", "'it''s'"]], "两个单引号是转义，不是字符串结束");
  assert.deepEqual(kinds(one('t = "say ""hi""";')), [["str", '"say ""hi"""']]);
});

test("注释：% 和续行 ... 之后是注释，字符串里的 % 不是", () => {
  assert.deepEqual(kinds(one("fprintf('%d%%\\n', n) % 打印")), [["str", "'%d%%\\n'"], ["com", "% 打印"]]);
  assert.deepEqual(kinds(one("a = 1 + ... 续到下一行")), [["num", "1"], ["com", "... 续到下一行"]]);
});

test("块注释 %{ %} 独占一行才算，可以嵌套；%% 是分节", () => {
  const lines = core.highlight("%{\nx = 1;\n%{\ninner\n%}\nstill\n%}\ny = 2;\n%% 第二节\n  %%\nz = 3; %% 行尾不算分节");
  assert.deepEqual(lines.slice(0, 7).map(l => l.tokens.map(t => t.t).join()), ["com", "com", "com", "com", "com", "com", "com"]);
  assert.deepEqual(kinds(lines[7]), [["num", "2"]]);
  assert.equal(lines[8].section, true);
  assert.equal(lines[9].section, true, "只有 %% 的行也是分节");
  assert.equal(lines[10].section, false);
  const inline = core.highlight("x = 1; %{ 不是块注释\ny = 2;");
  assert.deepEqual(kinds(inline[1]), [["num", "2"]], "%{ 不在独立一行时只是行注释");
});

test("关键字、数字、函数名；结构体字段 s.end 不是关键字", () => {
  assert.deepEqual(kinds(one("function [out, n] = bubble_sort(v)")), [["kw", "function"], ["def", "bubble_sort"]]);
  assert.deepEqual(one("function y = y(x)").tokens.slice(0, 4), [{ t: "kw", v: "function" }, { t: "text", v: " y = " }, { t: "def", v: "y" }, { t: "text", v: "(x)" }], "标出的是函数名那个 y，不是输出参数");
  assert.deepEqual(kinds(one("x = 1.5e-3 + 2i + .5;")), [["num", "1.5e-3"], ["num", "2i"], ["num", ".5"]]);
  assert.deepEqual(kinds(one("if s.end > 0, x(end) = 1; end")), [["kw", "if"], ["num", "0"], ["kw", "end"], ["num", "1"], ["kw", "end"]]);
});

test("着色不改动任何字符：拼回来等于原行", () => {
  const src = "\tfor i = 1:(n-1)\r\n        if a(i)' > b % x\r\n";
  const lines = core.highlight(src);
  assert.deepEqual(lines.map(l => l.tokens.map(t => t.v).join("")), ["\tfor i = 1:(n-1)", "        if a(i)' > b % x"]);
  assert.deepEqual(lines.map(l => l.indent), [4, 8], "制表符按 4 列");
});

test("解码：UTF-8、带 BOM 的 UTF-8、Windows-1252 的 è", () => {
  assert.deepEqual(core.decode(Buffer.from("% è ok", "utf8")), { text: "% è ok", encoding: "UTF-8" });
  assert.deepEqual(core.decode(Buffer.from([0xEF, 0xBB, 0xBF, 0x78])), { text: "x", encoding: "UTF-8" });
  assert.deepEqual(core.decode(Buffer.from([0x25, 0x20, 0xE8])), { text: "% è", encoding: "Windows-1252" });
  assert.deepEqual(core.splitLines("a\r\nb\rc\n"), ["a", "b", "c"]);
  assert.deepEqual(core.splitLines(""), [""]);
});

// 真实文件：课程文件夹里的每个 .m 都要能逐字还原，且不出现一个没闭合就吞到行尾的字符串。
test("课程里的真实 .m 文件逐字还原", () => {
  const root = path.resolve(__dirname, "../../../课程文件");
  const files = [];
  const walk = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.m$/i.test(e.name)) files.push(p); } };
  if (fs.existsSync(root)) walk(root);
  if (!files.length) return;
  for (const file of files) {
    const { text } = core.decode(fs.readFileSync(file));
    const lines = core.highlight(text);
    assert.deepEqual(lines.map(l => l.tokens.map(t => t.v).join("")), core.splitLines(text), path.basename(file));
    for (const [n, l] of lines.entries()) for (const t of l.tokens)
      if (t.t === "str") assert.ok(/(['"])$/.test(t.v) && t.v.length > 1, `${path.basename(file)}:${n + 1} 字符串没闭合：${t.v}`);
  }
});
