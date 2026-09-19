"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { luminance, ratio, themes, audit } = require("../contrast.js");

test("对比度按 WCAG 定义计算", () => {
  assert.equal(ratio("#ffffff", "#000000").toFixed(2), "21.00");
  assert.equal(ratio("#ffffff", "#ffffff").toFixed(2), "1.00");
  // 顺序不影响结果。
  assert.equal(ratio("#a34b2d", "#fffaf3").toFixed(2), ratio("#fffaf3", "#a34b2d").toFixed(2));
  assert.ok(luminance("#ffffff") > luminance("#808080"));
});

test("色值格式不对要报错，而不是悄悄算出一个数", () => {
  assert.throws(() => ratio("#fff", "#000000"), /六位十六进制/);
  assert.throws(() => ratio("red", "#000000"), /六位十六进制/);
});

const SAMPLE = [
  "/* 说明里也会写 body.theme-dark，不该被当成选择器。 */",
  ":root {",
  "  --os-bg: #e8e1d7;",
  "  --os-paper: #fffaf3;",
  "  --os-ink: #3d3029;",
  "}",
  "",
  "body.theme-dark {",
  "  --os-bg: #1e1814;",
  "  --os-paper: #342a21;",
  "}",
  "",
].join("\n");

test("解析两套主题，深色继承浅色里没重定义的项", () => {
  const { light, dark } = themes(SAMPLE);
  assert.equal(light["--os-bg"], "#e8e1d7");
  assert.equal(dark["--os-bg"], "#1e1814");
  // --os-ink 只在浅色里定义过，深色要继承下来，否则校验会漏掉深色正文。
  assert.equal(dark["--os-ink"], "#3d3029");
});

test("注释里的选择器名字不会被当成块的开头", () => {
  const { dark } = themes(SAMPLE);
  assert.equal(dark["--os-paper"], "#342a21");
});

test("真实令牌文件两套主题全部达标", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "..", "shared", "tokens.css"), "utf8");
  const bad = audit(css).filter((r) => !r.ok);
  assert.deepEqual(
    bad.map((r) => `${r.theme} ${r.a}/${r.b}=${r.actual && r.actual.toFixed(2)}`),
    []
  );
});

test("白卡配一条看得清的描边：面差不够也放行", () => {
  // 6.5 的实际取值：页面底提亮到 #F8F6F1 之后，卡片对页面底只有 1.08，
  // 分区整个交给 1px 描边。这是另一种正当做法，闸门不该把它和 6.0 那次混为一谈。
  const outlined = [
    ":root {",
    "  --os-bg: #F8F6F1;",
    "  --os-paper: #FFFFFF;",
    "  --os-soft: #EAE6DC;",
    "  --os-line: #C9C0AA;",
    "  --os-ink: #25201D;",
    "  --os-muted: #2D4739;",
    "  --os-accent: #8C382A;",
    "  --os-accent-2: #2D4739;",
    "  --os-danger: #8C2E20;",
    "}",
    "",
  ].join("\n");
  const rows = audit(outlined).filter((r) => r.theme === "light");
  const separation = rows.find((r) => r.kind === "surface" && r.parts);
  assert.equal(separation.ok, true, "描边 1.81 撑得住，应当放行");
  assert.ok(separation.parts[0].actual < 1.25, "而面与面的差确实不够");
  assert.deepEqual(rows.filter((r) => !r.ok), [], "这套配色整体应当全过");
});

test("塌掉的旧配色会被拦下", () => {
  // 6.0 的实际取值：卡片对页面底 1.11，分隔线对卡片 1.43，次要文字在 soft 上 4.18。
  const old = [
    ":root {",
    "  --os-bg: #f4eee5;",
    "  --os-paper: #fffaf3;",
    "  --os-soft: #eee4d7;",
    "  --os-line: #ded2c3;",
    "  --os-ink: #3d3029;",
    "  --os-muted: #7d685b;",
    "  --os-accent: #a34b2d;",
    "  --os-danger: #a33324;",
    "}",
    "",
  ].join("\n");
  const bad = audit(old).filter((r) => !r.ok && r.theme === "light");
  const pairs = bad.map((r) => `${r.a}/${r.b}`);
  assert.ok(pairs.includes("--os-line/--os-paper"), "分隔线应被判不合格");
  assert.ok(pairs.includes("--os-muted/--os-soft"), "次要文字在 soft 上应被判不合格");

  // 6.5 起「卡片要能被认出来」是一条二选一：面与面的明度差，或者一条看得清的描边。
  // 6.0 的毛病正是两样都没有——所以这里不只断言它不合格，还要断言两条候选各自都不够。
  // 只断言「不合格」的话，将来有人把其中一条的下限调到 0，这个测试照样绿。
  const separation = bad.find((r) => r.kind === "surface" && r.parts);
  assert.ok(separation, "卡片可辨性应被判不合格");
  assert.deepEqual(
    separation.parts.map((p) => `${p.a}/${p.b}=${p.actual.toFixed(2)}<${p.min}`),
    ["--os-paper/--os-bg=1.11<1.25", "--os-line/--os-paper=1.43<1.8"],
    "两条候选都该不够：面差 1.11、描边 1.43"
  );
});
