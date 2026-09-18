"use strict";

/**
 * 令牌对比度校验。
 *
 * 存在的理由：6.0 把令牌收成一处之后，配色「看起来不好看」第一次可以被量化。
 * 量出来的结果是：卡片对页面底 1.11、分隔线对卡片 1.43、次要文字铺在
 * soft 卡片上 4.18（低于 AA）。文字的颜色一直是对的，塌掉的是面与面之间的
 * 明度差——所有分区全靠一条几乎看不见的 1px 边框撑着。
 *
 * 这类问题眼睛判断不可靠（起草 6.1 方案时我两次凭截图判断颜色都判错了），
 * 所以做成构建期的硬失败，而不是写进文档里的建议。
 *
 * 不依赖 Obsidian 与文件系统，可直接 node --test。
 */

/** 相对亮度，WCAG 2.x 定义。 */
function luminance(hex) {
  const value = parse(hex);
  const channel = (raw) => {
    const v = raw / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(value >> 16 & 255) + 0.7152 * channel(value >> 8 & 255) + 0.0722 * channel(value & 255);
}

function parse(hex) {
  const text = String(hex || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(text)) throw new Error(`不是六位十六进制色值：${hex}`);
  return parseInt(text, 16);
}

/** 两色的对比度，1 到 21。 */
function ratio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * 从 tokens.css 里取出两套主题的色值。
 * 浅色取 `:root`，深色取 `body.theme-dark`——深色块只重定义一部分，
 * 其余继承浅色，所以这里也按同样的方式合并。
 */
function themes(css) {
  const text = String(css || "").replace(/\r\n?/g, "\n");
  const read = (selector) => {
    // 说明注释里也会出现选择器名字，所以要求它在行首且后面跟着 `{`。
    // 用行首锚点而不是 `\n` + 选择器：块可能就在文件第一行。
    const head = new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m");
    const found = head.exec(text);
    if (!found) return null;
    const start = found.index;
    const end = text.indexOf("\n}", start);
    const body = text.slice(start, end < 0 ? undefined : end);
    const out = {};
    for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[name] = value;
    return out;
  };
  const light = read(":root");
  if (!light) throw new Error("tokens.css 里找不到 :root");
  const dark = read("body.theme-dark") || {};
  return { light, dark: { ...light, ...dark } };
}

/**
 * 必须满足的关系。每一条都对应一次量出来的欠账，不是凑出来的数。
 * kind 为 text 的按 WCAG AA 正文 4.5；surface 是面与面的可分辨下限；
 * border 是承担分区职责的线，取 1.8（WCAG 对非文字元素要求 3.0，
 * 但那是针对图标和控件边界；这里是同色系的分隔线，1.8 已经能看清）。
 */
const RULES = [
  { a: "--os-paper", b: "--os-bg", min: 1.25, kind: "surface", why: "卡片要能从页面底上浮起来" },
  { a: "--os-bg", b: "--os-soft", min: 1.12, kind: "surface", why: "次级面要和页面底分得开" },
  { a: "--os-line", b: "--os-paper", min: 1.8, kind: "border", why: "分区全靠这条线" },
  { a: "--os-ink", b: "--os-paper", min: 4.5, kind: "text", why: "正文" },
  { a: "--os-muted", b: "--os-paper", min: 4.5, kind: "text", why: "次要文字在卡片上" },
  { a: "--os-muted", b: "--os-soft", min: 4.5, kind: "text", why: "次要文字在次级面上" },
  { a: "--os-muted", b: "--os-bg", min: 4.5, kind: "text", why: "次要文字在页面底上" },
  { a: "--os-accent", b: "--os-paper", min: 4.5, kind: "text", why: "强调色也当文字用" },
  { a: "--os-danger", b: "--os-paper", min: 4.5, kind: "text", why: "逾期提示" },
];

/** 返回 [{theme, a, b, min, actual, ok, why}]，调用方决定怎么报。 */
function audit(css, rules = RULES) {
  const sets = themes(css);
  const out = [];
  for (const [theme, tokens] of Object.entries(sets)) {
    for (const rule of rules) {
      const a = tokens[rule.a];
      const b = tokens[rule.b];
      if (!a || !b) {
        out.push({ theme, ...rule, actual: null, ok: false, missing: !a ? rule.a : rule.b });
        continue;
      }
      const actual = ratio(a, b);
      out.push({ theme, ...rule, actual, ok: actual >= rule.min - 0.005 });
    }
  }
  return out;
}

module.exports = { luminance, ratio, themes, audit, RULES };
