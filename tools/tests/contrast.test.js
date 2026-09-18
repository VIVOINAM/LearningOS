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
  assert.ok(pairs.includes("--os-paper/--os-bg"), "卡片与页面底应被判不合格");
  assert.ok(pairs.includes("--os-line/--os-paper"), "分隔线应被判不合格");
  assert.ok(pairs.includes("--os-muted/--os-soft"), "次要文字在 soft 上应被判不合格");
});
