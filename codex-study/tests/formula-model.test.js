"use strict";

// 速记的文本处理：粘贴来的一整段（中文夹着 \( \) 和 \[ \]）要变成 Obsidian 认得的 Markdown。
const test = require("node:test");
const assert = require("node:assert/strict");
const { toObsidianMarkdown, hasMath, changesOnPaste, MAX_LENGTH } = require("../core/formula-model.js");

test("行内公式：\\( \\) → $…$，且内侧不留空格", () => {
  assert.equal(toObsidianMarkdown("这些换行全部由 \\(P\\) 记录"), "这些换行全部由 $P$ 记录");
  // Obsidian 的 $…$ 里紧跟空格就不当公式解析，必须把内侧空格吃掉。
  assert.equal(toObsidianMarkdown("由 \\( P,L,U \\) 记录"), "由 $P,L,U$ 记录");
});

test("独占一行的公式：\\[ \\] → $$，前后各留一个空行", () => {
  assert.equal(toObsidianMarkdown("也就是：\n\\[ PA=LU \\]\n这里："), "也就是：\n\n$$\nPA=LU\n$$\n\n这里：");
});

test("同一行连写两段 \\[ \\]：拆成两个独立公式块，不挤成一段", () => {
  const out = toObsidianMarkdown("\\[ P=\\text{置换矩阵} \\]\\[ L=\\text{下三角} \\]");
  assert.equal(out, "$$\nP=\\text{置换矩阵}\n$$\n\n$$\nL=\\text{下三角}\n$$");
});

test("用户粘贴的那段 PLU：公式内容一个字符不动，只换定界符", () => {
  const pasted = [
    "这一定理是在说：",
    "\\[ \\boxed{\\text{任何方阵 }A\\text{，只要允许先交换行，就一定能做成 }LU\\text{ 分解}} \\]",
    "也就是：",
    "\\[ \\boxed{PA=LU} \\]",
    "这些“换行”全部由 \\(P\\) 记录，最后消出来的结果就是 \\(U\\)。",
    "",
    "* 换行了，就更新 \\(P\\)；",
  ].join("\n");
  const out = toObsidianMarkdown(pasted);

  assert.match(out, /^这一定理是在说：\n\n\$\$\n\\boxed\{\\text\{任何方阵 \}A/);
  assert.ok(out.includes("$$\n\\boxed{PA=LU}\n$$"), "boxed 里的内容原样保留");
  assert.ok(out.includes("这些“换行”全部由 $P$ 记录，最后消出来的结果就是 $U$。"), "行内公式就地替换，中文标点不受影响");
  assert.ok(out.includes("* 换行了，就更新 $P$；"), "列表项还是列表项");
  assert.ok(!out.includes("\\("), "不该残留 LaTeX 定界符");
  assert.ok(!out.includes("\\["), "不该残留 LaTeX 定界符");
  assert.ok(!/\n{3,}/.test(out), "不留多余空行");
});

test("整段只有一个公式时提升成独占一行：行内排版会把矩阵压扁", () => {
  const out = toObsidianMarkdown("\\(\\begin{pmatrix} 1&0\\\\ 2&1 \\end{pmatrix},\\)");
  assert.equal(out, "$$\n\\begin{pmatrix} 1&0\\\\ 2&1 \\end{pmatrix},\n$$");
});

test("代码块与行内代码整段让过去：里面的 \\( 是代码不是公式", () => {
  assert.equal(toObsidianMarkdown("用 `\\(x\\)` 表示"), "用 `\\(x\\)` 表示");
  const fenced = "```js\nconst s = '\\\\(x\\\\)';\n```";
  assert.equal(toObsidianMarkdown(fenced), fenced);
});

test("已经是 Markdown 的内容不动", () => {
  assert.equal(toObsidianMarkdown("已经写好的 $x^2$ 和\n\n$$\ny=1\n$$"), "已经写好的 $x^2$ 和\n\n$$\ny=1\n$$");
  assert.equal(toObsidianMarkdown("一句没有公式的话"), "一句没有公式的话");
});

test("空白、不换行空格、超长输入", () => {
  assert.equal(toObsidianMarkdown("  两端空白  "), "两端空白");
  assert.equal(toObsidianMarkdown("a\u00a0+\u00a0b"), "a + b");
  assert.equal(toObsidianMarkdown(""), "");
  assert.equal(toObsidianMarkdown(null), "");
  assert.equal(toObsidianMarkdown("x".repeat(MAX_LENGTH + 500)).length, MAX_LENGTH);
});

test("hasMath：决定要不要为一条批注启动 Markdown 渲染器", () => {
  assert.equal(hasMath("由 \\(P\\) 记录"), true);
  assert.equal(hasMath("$$x$$"), true);
  assert.equal(hasMath("一句普通批注"), false);
  assert.equal(hasMath(null), false);
});

test("changesOnPaste：没有定界符可翻译时让开，交给浏览器默认粘贴", () => {
  assert.equal(changesOnPaste("由 \\(P\\) 记录"), true);
  assert.equal(changesOnPaste("一句普通的话"), false);
  assert.equal(changesOnPaste("  一句普通的话  "), false, "只是首尾空白，不值得接管粘贴");
});
