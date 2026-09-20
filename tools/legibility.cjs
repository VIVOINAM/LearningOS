"use strict";

/**
 * 对抗性背景闸门：任何背景下文字都要认得出。
 *
 * 存在的理由：6.7 给页面底挂上 Windows 聚焦壁纸之后，整套配色的前提没了——
 * 它是按一个固定的底设计的，而壁纸是每天换的不受控输入。实拍截图上取样
 * 14 处文字，7 处低于 AA 4.5、5 处低于 3.0；页标题 2.15、分段未选 2.10。
 *
 * 更要命的是 --os-scrim 归用户那个「图片可见度」滑块管，能一路滑到 0——
 * 可读性被做成了一个能滑到零的设置项，而且对已有的两道闸门都不可见：
 * check.js 的色值规则只匹配六位十六进制，contrast.js 的 themes() 也只收
 * 十六进制，rgba 和运行时状态它们都量不到。
 *
 * 所以这一道不量令牌，量**渲染结果**：把界面摆在一组最坏背景上，
 * 在文字锚点处采样它真正压着的合成底色，和 getComputedStyle 的字色比。
 * 采样办法是把字设成 transparent 再截那一小块——这样拿到的是合成之后的
 * 真实底，而不是某个令牌声称的底。设计系统里那句「--os-paper 是玻璃叠在
 * 页面底上算出来的等效色，两者必须同步改」，说的就是手算等效色这件事
 * 靠人记；这里改成量出来。
 *
 * 用法：
 *   node tools/legibility.cjs            # 独立跑，用本文件自带的代表性结构
 *   require('./legibility.cjs').measure  # smoke-visual.cjs 拿它去量真实界面
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** WCAG AA 正文下限。锚点表里全是文字，所以不用 3.0 那档。 */
const MIN = 4.5;

/**
 * 最坏背景。全部是 CSS 渐变而不是图片：闸门不该依赖任何素材文件，
 * 否则素材丢了闸门就静默失效。前四种是极端值，后三种照着真实照片里
 * 最难对付的那几类挑——亮天空那条的色值直接取自实拍截图。
 * null 那一档是「没挂壁纸」，默认安装就是它，走的是钳位不生效的另一条路径。
 */
const BACKDROPS = {
  "纯白": "linear-gradient(#fff,#fff)",
  "纯黑": "linear-gradient(#000,#000)",
  "高饱和红": "linear-gradient(#e10600,#e10600)",
  "高饱和蓝": "linear-gradient(#0047d6,#0047d6)",
  "亮天空(实拍同色)": "linear-gradient(#045295 0%,#8fc7ee 60%,#dff1ff 100%)",
  "雪山高光": "linear-gradient(#f2f6fa 0%,#ffffff 50%,#e7eef4 100%)",
  "明暗对半": "linear-gradient(#08131c 0%,#08131c 49%,#f4fbff 51%,#f4fbff 100%)",
  "无壁纸": null,
};

/**
 * 锚点：每一类文字里余量最小的那个代表，不是全部文字——全部文字会让闸门
 * 跑得太慢，慢到有人想把它关掉。
 *
 * 新加的文字要么进这张表，要么在评审时明确说它是装饰。表本身不许悄悄变短：
 * measure() 会断言实际量到的锚点数不少于 minAnchors，否则选择器改名之后
 * 闸门会一声不响地什么都不量，然后报「全部达标」。
 */
const ANCHORS = [
  ["页标题", ".os-heading h1", "页面底"],
  ["页副标题", ".os-page-status", "页面底"],
  ["左栏品牌", ".os-wordmark", "左栏玻璃"],
  ["挂件标题", ".ow-title", "左栏玻璃"],
  ["卡内主标", ".os-panel-head h2", "玻璃卡"],
  ["任务标题", ".os-task-title", "玻璃卡"],
  ["任务元数据", ".os-row-meta", "玻璃卡"],
  ["统计瓦片说明", ".os-stat-tile span", "凹陷瓦片"],
  ["统计瓦片读数", ".os-stat-tile strong", "凹陷瓦片"],
  ["热力格子", ".os-heat-cell", "玻璃卡"],
  ["分段选中", ".os-modes .os-mode.is-active", "玻璃药丸"],
  ["分段未选", ".os-modes .os-mode:not(.is-active)", "玻璃槽"],
  ["页脚", ".os-footer", "页面底"],
];

function luminance(r, g, b) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const x = luminance(...a), y = luminance(...b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const hex = (c) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/**
 * 在一个已经渲染好的页面上量。
 *
 * @param page       Playwright 的 page，界面必须已经挂好
 * @param anchors    [[名字, 选择器, 压在什么上], ...]
 * @param themes     要量哪几套主题
 * @param minAnchors 至少要量到多少个锚点
 */
async function measure(page, { anchors = ANCHORS, themes = ["light", "dark"], minAnchors = 6 } = {}) {
  const rows = [];
  const seen = new Set();
  const themeBefore = await page.evaluate(() => document.body.className);

  for (const theme of themes) {
    for (const [backdrop, image] of Object.entries(BACKDROPS)) {
      await page.evaluate(({ theme, image }) => {
        // 最坏情况：用户把「图片可见度」滑到 100，画面层遮罩为 0。
        // 托底层不跟这个滑块走，所以这里量的正是「滑块滑到底之后还剩什么」。
        document.documentElement.style.setProperty("--os-scrim-opacity", "0");
        const dark = theme === "dark" ? "theme-dark" : "";
        if (image === null) {
          document.body.style.removeProperty("--os-wallpaper");
          document.body.className = dark;
        } else {
          document.body.style.setProperty("--os-wallpaper", image);
          document.body.className = (dark ? dark + " " : "") + "os-wallpaper-on";
        }
      }, { theme, image });
      await page.waitForTimeout(80);

      for (const [name, selector, on] of anchors) {
        const target = page.locator(selector).first();
        if (!(await target.count())) continue;
        const box = await target.boundingBox();
        if (!box || box.width < 4 || box.height < 4) continue;
        seen.add(name);

        const ink = await target.evaluate((el) => getComputedStyle(el).color);
        // 把字设成透明再采样：拿到的是这段字真正压着的合成底色。
        await target.evaluate((el) => { el.dataset.osProbe = el.style.color; el.style.color = "transparent"; });
        const shot = await page.screenshot({
          clip: { x: box.x + 3, y: box.y + box.height / 2 - 1, width: 6, height: 3 },
        });
        await target.evaluate((el) => { el.style.color = el.dataset.osProbe || ""; delete el.dataset.osProbe; });

        const bg = await page.evaluate(async (b64) => {
          const img = new Image();
          img.src = "data:image/png;base64," + b64;
          await img.decode();
          const canvas = document.createElement("canvas");
          canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const d = ctx.getImageData(0, 0, img.width, img.height).data;
          let r = 0, g = 0, b = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
          return [r / n, g / n, b / n];
        }, shot.toString("base64"));

        const rgb = ink.match(/\d+/g).slice(0, 3).map(Number);
        const value = ratio(bg, rgb);
        rows.push({ theme, backdrop, name, on, bg: hex(bg), ink: hex(rgb), value, ok: value >= MIN - 0.005 });
      }
    }
  }

  // 还原，免得把测量用的状态留给后面的断言。
  await page.evaluate((cls) => {
    document.body.className = cls;
    document.body.style.removeProperty("--os-wallpaper");
    document.documentElement.style.removeProperty("--os-scrim-opacity");
  }, themeBefore);

  if (seen.size < minAnchors) {
    throw new Error(`只量到 ${seen.size} 个锚点（要求至少 ${minAnchors}）：锚点表和界面对不上了。` +
      `选择器改名之后闸门会一声不响地什么都不量。量到的是：${[...seen].join("、")}`);
  }
  return rows;
}

/** 整理成「哪些不过」「最难的一处」「每个组合最难的那一处」。 */
function report(rows) {
  const bad = rows.filter((r) => !r.ok);
  const worst = rows.reduce((m, r) => (r.value < (m ? m.value : Infinity) ? r : m), null);
  const combos = new Map();
  for (const r of rows) {
    const key = `${r.theme === "light" ? "浅" : "深"} / ${r.backdrop}`;
    if (!combos.has(key) || r.value < combos.get(key).value) combos.set(key, r);
  }
  return { bad, worst, combos };
}

module.exports = { BACKDROPS, ANCHORS, MIN, measure, report, ratio, luminance };

/* ---------------- 独立模式 ---------------- */

// 独立跑时用下面这段代表性结构，图的是快：改完令牌想马上知道数字，
// 不必把整个工作台挂起来。**它不是闸门本身**——闸门是 smoke-visual.cjs
// 里那一趟，量的是真正挂载的界面。这段结构和真界面对不上时，那一趟先失败。
const STANDALONE = `<div class="os-root" style="height:100vh"><div class="os-app">
 <div class="os-rail"><div class="os-brand"><div class="os-mark">L</div>
   <div class="os-wordmark">Learning OS</div></div>
   <div class="ow-card"><div class="ow-title">时间</div></div></div>
 <div class="os-main">
  <div class="os-header"><div class="os-heading"><h1>今日</h1>
    <div class="os-page-status">9月19日星期六 · 把今天，留给重要的事。</div></div></div>
  <div class="os-content">
   <div class="os-panel" style="margin-bottom:16px">
    <div class="os-panel-head"><h2>下一步行动</h2></div>
    <div class="os-panel-body">
      <div class="os-task-title">复习伯努利方程的适用条件</div>
      <div class="os-row-meta">本周学习计划</div>
      <div class="os-stat-tiles"><div class="os-stat-tile"><strong>30</strong><span>专注分钟</span></div></div>
    </div></div>
   <div class="os-panel os-focus"><div class="os-panel-body">
    <div class="os-modes" style="width:260px">
      <button class="os-mode is-active">专注</button><button class="os-mode">短休</button>
    </div></div></div>
  </div>
  <div class="os-footer">85 项待办 · 1 篇待复习</div>
 </div></div></div>`;

if (require.main === module) {
  (async () => {
    const { chromium } = require(process.env.PLAYWRIGHT_PATH ||
      "C:/Users/longf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
    const browser = await chromium.launch({ headless: true, channel: "msedge" });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;height:100%}
      body{--font-interface:"Segoe UI","Microsoft YaHei",sans-serif}button,input{font:inherit}</style>${STANDALONE}`);
    await page.addStyleTag({ content: fs.readFileSync(path.join(ROOT, "shared/tokens.css"), "utf8") });
    await page.addStyleTag({ content: fs.readFileSync(path.join(ROOT, "codex-workbench/styles.css"), "utf8") });
    await page.addStyleTag({ content: fs.readFileSync(path.join(ROOT, "codex-widgets/styles.css"), "utf8") });

    const rows = await measure(page);
    const { bad, worst, combos } = report(rows);
    console.log(`[可读性] ${rows.length} 次取样（2 主题 × ${Object.keys(BACKDROPS).length} 背景），下限 ${MIN}`);
    if (bad.length) {
      console.error(`[可读性] ${bad.length} 处不达标：`);
      console.table(bad.slice(0, 40).map((r) => ({
        主题: r.theme === "light" ? "浅" : "深", 背景: r.backdrop, 文字: r.name,
        压在: r.on, 局部底: r.bg, 字色: r.ink, 实测: r.value.toFixed(2),
      })));
    }
    console.table([...combos].map(([k, r]) => ({
      组合: k, 最难的文字: r.name, 压在: r.on, 实测: r.value.toFixed(2), 结论: r.ok ? "过" : "不过",
    })));
    console.log(`最难的一处：${worst.theme === "light" ? "浅" : "深"} / ${worst.backdrop} / ${worst.name} = ${worst.value.toFixed(2)}`);
    await browser.close();
    process.exit(bad.length ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
