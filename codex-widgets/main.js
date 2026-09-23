"use strict";

const { Plugin, Modal, Notice, requestUrl, setIcon } = require("obsidian");
const { el, btn } = require("../shared/dom");
const { day } = require("../shared/date");
const core = require("./core/widgets");

/**
 * Codex 侧栏挂件。
 *
 * 工作台左栏里，导航和底部按钮之间有 ~390px 是布局逼出来的空白：
 * `.os-nav{flex:1}` 加 `.os-rail-foot{margin-top:auto}`，中间那段永远撑着。
 * 这个插件把那段空白变成可配置的几块内容。
 *
 * 它不知道工作台的存在：对外只有 `renderRail(host)`，谁调谁得到一块 DOM。
 * 工作台停用时这个插件照样能装，只是没人来调——这和 focus / recall 的关系一样。
 */

const MOUNT_TICK = 1000;
// 取天气失败后的最短重试间隔。正常刷新走 weather.refreshMinutes，这个只管失败路径。
const RETRY_AFTER = 60000;

/* ---------- 天气图标：自绘 ---------- */

/**
 * 为什么是内联 SVG，不是图片文件：部署白名单只有 main.js、manifest.json、
 * styles.css 三个（见架构与边界），资源文件根本到不了 .obsidian/plugins。
 * 这条也定了复杂度上限——能画云飘、雨落、日轮转，画不了逐帧序列。
 *
 * 为什么用 createElementNS 而不是 innerHTML：省掉一处 HTML 注入面，
 * 也让每个可动的部件能拿到 class，动画留在 styles.css 里。
 *
 * 动画只走 transform 和 opacity，一律不碰布局属性。6.6.1 那一轮查了四个
 * 闪烁来源，最后关掉 backdrop-filter 才把界面稳住；7.0 又把模糊打开了
 * （壁纸底下它重新有意义），所以这里引起一次重排的代价比 6.6 更高。
 */
const SVG_NS = "http://www.w3.org/2000/svg";

function svg(parent, name, attrs) {
  const node = document.createElementNS(SVG_NS, name);
  for (const key in attrs) node.setAttribute(key, attrs[key]);
  parent.appendChild(node);
  return node;
}

// 描边式，和退路 lucide 是同一种画法——退不回去的时候两者不该长得判若两图。
const CLOUD = "M7 17.6h9.6a3.6 3.6 0 0 0 .2-7.2 5.2 5.2 0 0 0-9.9-1.3A3.8 3.8 0 0 0 7 17.6Z";

/** 八根光芒，绕中心排一圈。手写八条 line 只会写错其中一条。 */
function sunRays(parent, cx, cy, inner, outer) {
  const rays = svg(parent, "g", { class: "ow-art-rays" });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    svg(rays, "line", {
      x1: (cx + Math.cos(a) * inner).toFixed(2), y1: (cy + Math.sin(a) * inner).toFixed(2),
      x2: (cx + Math.cos(a) * outer).toFixed(2), y2: (cy + Math.sin(a) * outer).toFixed(2),
    });
  }
  return rays;
}

/** 落下来的东西：雨滴、雪花、冰粒共用一套错开的下落节奏。 */
function fallers(parent, xs, make) {
  xs.forEach((x, i) => {
    const g = svg(parent, "g", { class: "ow-art-fall", style: `--ow-fall-delay:${(i * 0.33).toFixed(2)}s` });
    make(g, x, i);
  });
}

/** 十幕，和 core.SCENES 一一对应。 */
const SCENE_ART = {
  sun(root) {
    sunRays(root, 12, 12, 6.6, 9.2);
    svg(root, "circle", { cx: 12, cy: 12, r: 4.2 });
  },
  "sun-cloud"(root) {
    // 太阳往左上退、云往右下压，两者只在一角相交。第一版两个同心摆，
    // 光芒直接穿过云身，看着像一团乱线。
    sunRays(root, 8, 7, 4.2, 6);
    svg(root, "circle", { cx: 8, cy: 7, r: 2.6 });
    const front = svg(root, "g", { transform: "translate(3.2 3.4) scale(.84)" });
    svg(front, "path", { d: CLOUD, class: "ow-art-drift" });
  },
  cloud(root) {
    svg(root, "path", { d: CLOUD, class: "ow-art-drift" });
  },
  overcast(root) {
    // 摆位放在外层 g 上，动画放在里层 path 上：CSS 的 transform 会整个盖掉
    // transform 这个呈现属性，写在同一个节点上就等于把摆位弄丢。
    const back = svg(root, "g", { transform: "translate(-4.6 -4.4) scale(.70)" });
    svg(back, "path", { d: CLOUD, class: "ow-art-drift is-back" });
    svg(root, "path", { d: CLOUD, class: "ow-art-drift" });
  },
  fog(root) {
    // 云整体上提，给下面三条雾线让出位置。第一版间距 2.1 而描边就有 1.6，
    // 三条粘成一块实心，整个图标读成一个罐子。
    const top = svg(root, "g", { transform: "translate(0 -4)" });
    svg(top, "path", { d: CLOUD });
    [0, 1, 2].forEach((i) => {
      const inset = i * 1.4;
      svg(root, "line", {
        x1: (5.6 + inset).toFixed(2), y1: 18.8 + i * 2.9,
        x2: (18.4 - inset).toFixed(2), y2: 18.8 + i * 2.9,
        class: "ow-art-haze", style: `--ow-fall-delay:${(i * 0.5).toFixed(2)}s`,
      });
    });
  },
  drizzle(root) {
    svg(root, "path", { d: CLOUD });
    fallers(root, [10, 14.4], (g, x) => svg(g, "line", { x1: x, y1: 19.4, x2: x - 0.5, y2: 21.2 }));
  },
  rain(root) {
    svg(root, "path", { d: CLOUD });
    fallers(root, [8.6, 12, 15.4], (g, x) => svg(g, "line", { x1: x, y1: 19.2, x2: x - 0.8, y2: 22 }));
  },
  snow(root) {
    svg(root, "path", { d: CLOUD });
    // 实心点，不是六角星。26px 上画星形，三个的横臂会连成一条杠——
    // 分辨率不够的时候，形状要靠轮廓区分，不靠内部细节。
    // 和雨的区别因此是「圆点 vs 斜线」，那个在任何尺寸下都分得开。
    fallers(root, [8.6, 12, 15.4], (g, x, i) => {
      svg(g, "circle", { cx: x, cy: 20.4 + (i === 1 ? 1.4 : 0), r: 1.05, fill: "currentColor", stroke: "none" });
    });
  },
  thunder(root) {
    svg(root, "path", { d: CLOUD });
    svg(root, "path", { d: "M12.8 18.6 10.6 21.8h2.6l-1.4 2.6", class: "ow-art-bolt" });
  },
  hail(root) {
    svg(root, "path", { d: CLOUD });
    // 两侧斜雨、正中一颗冰粒，三者不许在横向上叠。第一版雨滴在 9 / 15、
    // 冰粒在 12 且高度相同，三个糊成一坨。
    fallers(root, [8.2, 16], (g, x) => svg(g, "line", { x1: x, y1: 19.2, x2: x - 0.7, y2: 21.3 }));
    fallers(root, [12], (g, x) =>
      svg(g, "circle", { cx: x, cy: 22.2, r: 1.15, fill: "currentColor", stroke: "none", class: "ow-art-stone" }));
  },
};

// Windows 桌面聚焦的图片缓存。锁屏那套在 ContentDeliveryManager 下，
// 但它只在开了锁屏聚焦时才有东西；桌面这一路更靠谱，而且文件带 .jpg 扩展名。
const SPOTLIGHT_DIR = "AppData/Local/Packages/MicrosoftWindows.Client.CBS_cw5n1h2txyewy/LocalCache/Microsoft/IrisService";
// 小于这个大小的是缩略图和图标，不是壁纸。
const SPOTLIGHT_MIN_BYTES = 200000;
// 只读文件头就够：SOF 段一定在图像数据之前。整张读进来的话，
// 扫一遍两百多个文件要动几百 MB，而实际只需要前几十 KB。
const SPOTLIGHT_HEAD = 32768;

class CodexWidgets extends Plugin {
  async onload() {
    this.data = core.normalize(await this.loadData());
    this.mounts = new Set();
    this.queue = Promise.resolve();

    this.addCommand({ id: "settings", name: "侧栏挂件设置", callback: () => this.openSettings() });
    this.addCommand({ id: "refresh-weather", name: "立即刷新天气", callback: () => this.fetchWeather(true).catch((e) => new Notice(e.message)) });

    // 一个计时器喂所有挂载点。此前的写法是每个 renderRail 自己 setInterval，
    // 工作台反复 refresh 之后会留下一串还在跑的旧计时器。
    this.registerInterval(window.setInterval(() => this.tick(), MOUNT_TICK));
    // 窗口不在前台时让天气图标停下来。不挂在每秒那一拍上：可见性一天变不了
    // 几次，而 tick 喂着所有挂载点，往里加活最贵。
    this.registerDomEvent(document, "visibilitychange", () => this.repaint());
    this.apiVersion = 1;
    if (this.weatherWanted()) this.fetchWeather().catch((e) => console.error("天气获取失败", e));
    this.applyWallpaperVisibility();
    this.applyGlassTint();
    this.applyWallpaper();
  }

  /** 天气挂件开着，并且坐标填了。两个条件缺一个就一次网都不发。 */
  weatherWanted() {
    return this.data.order.some((entry) => entry.id === "weather" && entry.on) && core.weatherUrl(this.data.weather) !== "";
  }

  onunload() {
    for (const mount of [...this.mounts]) mount.destroy();
    this.mounts.clear();
    this.clearWallpaper();
    document.documentElement.style.removeProperty("--os-scrim-opacity");
    document.documentElement.style.removeProperty("--os-glass-tint");
  }

  /* ---------- Windows 聚焦壁纸 ---------- */

  /** 设置里用的是「图片可见度」，CSS 遮罩用的是相反的不透明度。 */
  applyWallpaperVisibility() {
    const visibility = core.wallpaperVisibility(this.data.wallpaper.visibility);
    const opacity = Number((1 - visibility / 100).toFixed(2));
    // --os-scrim 在 :root 定义；依赖变量也必须写到根节点，才能参与它的计算。
    document.documentElement.style.setProperty("--os-scrim-opacity", String(opacity));
  }

  /**
   * 玻璃浓度。和遮罩一样写到根节点：--os-glass 在 :root / body.theme-dark 上定义，
   * 它依赖的变量必须在那一层就有值，写到 .os-root 上它看不见。
   *
   * 这个滑块只管玻璃底色的浓淡。玻璃背后的扩散与亮度钳位不跟它走——那是字的底线，
   * iOS 27 的「极清透」会把它一起放掉，这里不放：可读性不做成能滑到零的设置。
   */
  applyGlassTint() {
    const tint = core.glassTint(this.data.wallpaper.glassTint);
    document.documentElement.style.setProperty("--os-glass-tint", String(tint / 100));
  }

  /**
   * 把今天那张聚焦图挂到 --os-wallpaper 上。
   *
   * 这是这个插件第二次碰 Vault 之外的东西，但和天气不同：只读本地文件，
   * 一个字节都不出门。整条路径上的每一步都可能不存在（没装 Windows、
   * 没开聚焦、目录被清过、文件读不动），所以全程 try/catch，
   * 失败就什么都不做——背景退回那两道渐变，界面照常。
   */
  applyWallpaper() {
    if (!this.data.wallpaper.on) { this.clearWallpaper(); return; }
    try {
      const today = day();
      // 偏移来自「换一张」，只在当天有效——跨日由 core.wallpaperShift 归零，
      // 这里不写回数据，免得一个只读的渲染路径顺手改了设置。
      const picked = core.pickWallpaper(this.scanWallpapers(), today, core.wallpaperShift(this.data.wallpaper, today));
      if (!picked) { this.clearWallpaper(); return; }
      if (this.wallpaperPath === picked) return;   // 同一张，别重新读一遍几 MB
      const bytes = require("fs").readFileSync(picked);   // 只有选中那一张才整张读
      const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
      this.clearWallpaper();
      this.wallpaperUrl = url;
      this.wallpaperPath = picked;
      this.wallpaperDay = today;
      // 挂在 body 上，靠继承传下去：挂件插件不该知道 .os-root 长什么样。
      document.body.style.setProperty("--os-wallpaper", `url("${url}")`);
      // 第二个声明，和 --os-wallpaper 同进同出：告诉样式表「背后现在是一张照片」。
      // 玻璃的亮度钳位挂在这个类上——没有照片时钳位反而会把暖燕麦底压成灰。
      document.body.classList.add("os-wallpaper-on");
    } catch (error) {
      console.error("聚焦壁纸未启用：", error.message);
      this.clearWallpaper();
    }
  }

  clearWallpaper() {
    if (this.wallpaperUrl) URL.revokeObjectURL(this.wallpaperUrl);
    this.wallpaperUrl = "";
    this.wallpaperPath = "";
    document.body.style.removeProperty("--os-wallpaper");
    document.body.classList.remove("os-wallpaper-on");
  }

  /** 走一遍聚焦缓存，挑出横版。只读文件头判尺寸，两百多个文件约 110ms。 */
  scanWallpapers() {
    const nodeFs = require("fs"), nodePath = require("path"), os = require("os");
    // 移动端和任何拿不到 Node 的环境：直接交白卷，不要走到下面去抛一个 TypeError。
    // 「读不到就退回渐变」是正常路径，不该在控制台里留一行红字。
    if (!nodeFs?.readdirSync || !nodePath?.join || !os?.homedir) return [];
    const root = nodePath.join(os.homedir(), ...SPOTLIGHT_DIR.split("/"));
    const head = Buffer.alloc(SPOTLIGHT_HEAD);
    const out = [];
    for (const name of nodeFs.readdirSync(root)) {
      const dir = nodePath.join(root, name);
      let entries;
      try { if (!nodeFs.statSync(dir).isDirectory()) continue; entries = nodeFs.readdirSync(dir); }
      catch { continue; }
      for (const entry of entries) {
        if (!entry.toLowerCase().endsWith(".jpg")) continue;
        const file = nodePath.join(dir, entry);
        try {
          if (nodeFs.statSync(file).size < SPOTLIGHT_MIN_BYTES) continue;
          const fd = nodeFs.openSync(file, "r");
          const read = nodeFs.readSync(fd, head, 0, head.length, 0);
          nodeFs.closeSync(fd);
          if (core.usableWallpaper(core.jpegSize(head.subarray(0, read)))) out.push(file);
        } catch { /* 单个文件读不动就跳过，不影响其余 */ }
      }
    }
    return out;
  }

  save() {
    this.queue = this.queue.then(() => this.saveData(this.data)).catch((e) => { console.error("挂件设置保存失败", e); throw e; });
    return this.queue;
  }

  /* ---------- 对外 API ---------- */

  /**
   * 在 host 里渲染挂件，返回一个句柄。
   * 调用方必须在自己销毁时调 destroy()，否则计时器会对着一棵已经脱离文档的树跑。
   *
   * slot 是 "top" 或 "bottom"：左栏有两块地方，导航上面和导航下面。
   * 哪个挂件去哪一块由用户在设置里定，调用方只负责提供这两块地方。
   */
  renderRail(host, { slot = "bottom" } = {}) {
    if (!host) return null;
    const mount = {
      host, slot,
      destroy: () => { this.mounts.delete(mount); host.replaceChildren(); },
      paint: () => this.paint(host, slot),
    };
    this.mounts.add(mount);
    mount.paint();
    return mount;
  }

  /** 设置改了之后，所有挂载点重画一遍。 */
  repaint() { for (const mount of this.mounts) mount.paint(); }

  /** 只更新走秒的部分，不重建整棵树——重建会让每秒一次的 DOM 替换打断焦点。 */
  tick() {
    const now = new Date();
    for (const mount of this.mounts) {
      if (!mount.host.isConnected) { mount.destroy(); continue; }
      const clock = mount.host.querySelector("[data-ow-clock]");
      if (clock) clock.textContent = core.clockText(now, this.data.clock);
      const date = mount.host.querySelector("[data-ow-date]");
      // 也要重写时段：跨正午那一秒如果只更新读数，「上午」会一直挂到下次整棵树重画。
      if (date) date.textContent = this.data.clock.date ? core.dateText(now) : "";
    }
    // 跨日换一张壁纸。判断的是日期字符串，不是「跑了多少秒」——
    // 后者在休眠唤醒之后会错过换日那一刻。
    if (this.data.wallpaper.on && this.wallpaperDay && this.wallpaperDay !== day()) this.applyWallpaper();

    // 两道闸：weatherWanted 挡住没填坐标的默认状态（否则 tick 每秒抛一个「先填经纬度」），
    // lastAttempt 挡住断网时的每秒重试（取不到 -> cache 还是旧的 -> 仍然 stale -> 下一拍再来）。
    if (this.weatherWanted() && core.weatherStale(this.data.weather.cache, this.data.weather.refreshMinutes)
        && Date.now() - (this.lastAttempt || 0) >= RETRY_AFTER) {
      this.fetchWeather().catch(() => {});
    }
  }

  /* ---------- 渲染 ---------- */

  paint(host, slot = "bottom") {
    host.replaceChildren();
    const active = core.activeWidgets(this.data, slot);
    const inline = slot === "header";
    for (const id of active) {
      const card = el(host, "section", `ow-card ow-${id}`);
      card.setAttribute("aria-label", core.LABELS[id]);
      // 页头那一行只有一行高，竖着摆的卡片放不进去：每个挂件另有一套横排渲染，
      // 没写横排版本的就退回卡片版——宁可在页头里长得像张小卡，也不要什么都不画。
      const paintInline = inline && this[`inline_${id}`];
      (paintInline || this[`paint_${id}`]).call(this, card);
    }
    if (slot !== "bottom") { host.toggleAttribute("data-empty", active.length === 0); return; }
    // 齿轮只画在导航下方那块：设置入口一个就够，而那块本来就是富余空间。
    // data-empty 判断的是「这一块空不空」而不是「有没有挂件」——三个挂件全搬去别处时，
    // 这里会是左栏里唯一的设置入口，得一直看得见，不能等鼠标划过去才浮出来。
      host.toggleAttribute("data-empty", active.length === 0);
    const gear = btn(host, "挂件设置", () => this.openSettings(), "ow-gear");
    gear.setAttribute("aria-label", "侧栏挂件设置");
  }

  /**
   * 图标现在该不该动。三个条件都在 core.weatherAnimated 里，这里只负责取值。
   *
   * stale 包含「取数失败」：weatherError 非空时读数一定是旧的那份缓存。
   */
  weatherMoves() {
    const w = this.data.weather;
    const stale = !!this.weatherError || core.weatherStale(w.cache, w.refreshMinutes);
    const reduced = !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    return core.weatherAnimated({ stale, reduced, hidden: !!document.hidden });
  }

  /**
   * 画一个天气图标。
   *
   * 画不出来（幕缺了）就退回 lucide 字形，再不行整段去掉只留温度——
   * 自绘之前那条退路是 setIcon 自带的，自绘之后得自己留着。
   */
  weatherArt(parent, code, animated) {
    const scene = core.weatherScene(code);
    const draw = SCENE_ART[scene];
    if (!draw) {
      const mark = el(parent, "span", "ow-art-fallback");
      setIcon?.(mark, core.weatherIcon(code));
      if (!mark.childElementCount) mark.remove();
      return null;
    }
    const node = svg(parent, "svg", {
      class: `ow-art ow-art-is-${scene}`, viewBox: "0 0 24 26",
      fill: "none", stroke: "currentColor", "stroke-width": "1.6",
      "stroke-linecap": "round", "stroke-linejoin": "round",
      "aria-hidden": "true", focusable: "false",
    });
    draw(node);
    // 静止不是「暂停动画」，是一个状态：读数没更新时它就不该在动。
    if (!animated) node.setAttribute("data-still", "");
    return node;
  }

  /**
   * 天气的横排版。7.0 之前是「字形 + 温度 + 天气 + 地名」四样平铺在一行，
   * 每样一样重；现在是一个读数块：温度当主（走 --os-display，和专注计时、
   * 左栏时钟同一种字的三个尺寸），天气和地名退成它底下的一行小字。
   *
   * 能这么做是因为页头那条托底带先落了。在那之前这块文字直接压在照片上，
   * 实测 6.72 而且是撞上的——那时候把它放大，只会得到一个更大的、
   * 更看不清的气温。
   */
  inline_weather(card) {
    const cache = this.data.weather.cache;
    if (!cache) { el(card, "span", "ow-muted", this.weatherError || "获取中…"); return; }
    this.weatherArt(card, cache.code, this.weatherMoves());
    const read = el(card, "span", "ow-wx-read");
    el(read, "span", "ow-wx-temp", `${cache.temp}°`);
    const meta = [core.weatherText(cache.code), this.data.weather.place].filter(Boolean);
    el(read, "span", "ow-wx-meta", meta.join(" · "));
  }

  /**
   * 读数独占一行，「上午 / 下午」并进日期那行。
   * 时段和日期都是限定语，放一起；读数是唯一要一眼看清的东西，不和任何东西抢宽度。
   * 十二小时制关掉、或日期那行关掉时，这一行照样能只显示另一半。
   */
  paint_clock(card) {
    const now = new Date();
    el(card, "div", "ow-clock-time", core.clockText(now, this.data.clock)).setAttribute("data-ow-clock", "");
    const meta = [this.data.clock.date ? core.dateText(now) : ""].filter(Boolean);
    if (meta.length) el(card, "div", "ow-clock-date", meta.join(" · ")).setAttribute("data-ow-date", "");
  }

  paint_quote(card) {
    el(card, "p", "ow-quote-text", core.pickQuote(this.data.quote.lines, day()));
  }

  paint_countdown(card) {
    // 不画「倒计日」标题：一行「学期结束 · 还有 94 天」自己说得清，
    // 而在 196px 的左栏里，那个标题占掉的高度和它底下的内容一样多。
    const items = core.sortedCountdowns(this.data.countdown.items).slice(0, this.data.countdown.max);
    for (const item of items) {
      const row = el(card, "div", "ow-count-row");
      el(row, "span", "ow-count-name", item.name).title = `${item.name} · ${item.date}`;
      el(row, "span", `ow-count-days ${item.days < 0 ? "is-past" : item.days <= 7 ? "is-near" : ""}`, core.countdownLabel(item.days));
    }
  }

  /** 左栏竖版。和横排版共用同一幕，只是排布不同——两处不该长成两种天气。 */
  paint_weather(card) {
    el(card, "p", "ow-title", this.data.weather.place || "天气");
    const cache = this.data.weather.cache;
    if (!cache) { el(card, "p", "ow-muted", this.weatherError || "获取中…"); return; }
    const row = el(card, "div", "ow-wx-row");
    this.weatherArt(row, cache.code, this.weatherMoves());
    el(row, "div", "ow-wx-temp", `${cache.temp}°`);
    el(card, "div", "ow-wx-meta", core.weatherText(cache.code));
  }

  /* ---------- 天气 ---------- */

  /**
   * 唯一一处对外发请求。坐标由 core.weatherUrl 降到两位小数，
   * 不带任何标识、不带 vault 里的任何东西；拿不到就保留上一次的缓存继续显示。
   */
  async fetchWeather(force = false) {
    const url = core.weatherUrl(this.data.weather);
    if (!url) throw Error("先在挂件设置里填写经纬度");
    if (!force && !core.weatherStale(this.data.weather.cache, this.data.weather.refreshMinutes)) return this.data.weather.cache;
    if (this.fetching) return this.fetching;
    this.lastAttempt = Date.now();
    this.fetching = (async () => {
      try {
        const response = await requestUrl({ url, method: "GET" });
        const entry = core.weatherFromResponse(response.json);
        if (!entry) throw Error("天气接口返回了看不懂的内容");
        this.data.weather.cache = entry;
        this.weatherError = "";
        await this.save();
      } catch (error) {
        // 网断了就留着旧值。天气挂件显示一小时前的气温，比显示一个错误提示有用。
        this.weatherError = `暂时取不到天气：${error.message}`;
        if (!this.data.weather.cache) throw error;
      } finally {
        this.fetching = null;
        this.repaint();
      }
      return this.data.weather.cache;
    })();
    return this.fetching;
  }

  openSettings() { new WidgetSettings(this).open(); }
}

/**
 * 设置弹窗。项目里没有一个插件用 PluginSettingTab，都是 Modal——
 * 这个跟着来，理由是挂件设置几乎总是从侧栏那个齿轮点进来的，
 * 而不是从 Obsidian 设置里翻五层找到。
 */
class WidgetSettings extends Modal {
  constructor(plugin) { super(plugin.app); this.p = plugin; }

  onOpen() {
    const root = this.contentEl;
    root.classList.add("ow-settings");
    el(root, "h2", "", "侧栏挂件");
    el(root, "p", "ow-muted", "勾选要显示的挂件，箭头调顺序。位置按钮在三个地方之间轮换：导航上（品牌和导航之间）、导航下（导航和快速捕获之间那段空档）、页头（今日页标题那一行的右端，横着排）。");
    this.renderOrder(el(root, "div", "ow-order"));
    this.renderClock(el(root, "details", "ow-section"));
    this.renderQuote(el(root, "details", "ow-section"));
    this.renderCountdown(el(root, "details", "ow-section"));
    this.renderWeather(el(root, "details", "ow-section"));
    this.renderWallpaper(el(root, "details", "ow-section"));
    const actions = el(root, "div", "ow-actions");
    el(actions, "span", "ow-save-state").setAttribute("role", "status");
    this.state = actions.querySelector(".ow-save-state");
    btn(actions, "关闭", () => this.close(), "ow-primary");
  }

  onClose() { this.contentEl.empty(); }

  /** 每次改动都立即落盘并重画侧栏，所以这个弹窗没有「保存」按钮。 */
  async commit(message = "已保存") {
    try { await this.p.save(); this.p.repaint(); if (this.state) this.state.textContent = message; }
    catch (error) { if (this.state) this.state.textContent = `未保存：${error.message}`; }
  }

  renderOrder(host) {
    const draw = () => {
      host.replaceChildren();
      this.p.data.order.forEach((entry, index) => {
        const row = el(host, "div", "ow-order-row");
        const label = el(row, "label", "ow-order-label");
        const box = el(label, "input");
        box.type = "checkbox";
        box.checked = entry.on;
        box.setAttribute("aria-label", `显示${core.LABELS[entry.id]}挂件`);
        box.onchange = () => { entry.on = box.checked; this.commit(); };
        el(label, "span", "", core.LABELS[entry.id]);
        const move = (delta) => {
          const to = index + delta;
          if (to < 0 || to >= this.p.data.order.length) return;
          const list = this.p.data.order;
          [list[index], list[to]] = [list[to], list[index]];
          draw();
          this.commit("顺序已保存");
        };
        // 三档轮换。按钮上的字就是它当前在哪，点一下去下一个地方。
        // 三个取值仍然不值得一个下拉——读按钮上那两个字比展开一个列表快。
        const slotHint = (id) => `${core.LABELS[entry.id]}：现在在${core.SLOT_LABELS[id]}，点击换到下一个位置`;
        const place = btn(row, core.SLOT_LABELS[entry.slot], () => {
          entry.slot = core.SLOTS[(core.SLOTS.indexOf(entry.slot) + 1) % core.SLOTS.length];
          place.textContent = core.SLOT_LABELS[entry.slot];
          place.setAttribute("aria-label", slotHint(entry.slot));
          this.commit("位置已保存");
        }, "ow-slot");
        place.setAttribute("aria-label", slotHint(entry.slot));
        btn(row, "↑", () => move(-1), "ow-move").setAttribute("aria-label", `${core.LABELS[entry.id]}上移`);
        btn(row, "↓", () => move(1), "ow-move").setAttribute("aria-label", `${core.LABELS[entry.id]}下移`);
      });
    };
    draw();
  }

  section(host, title, hint) {
    el(host, "summary", "", title);
    if (hint) el(host, "p", "ow-muted", hint);
    return host;
  }

  renderClock(host) {
    this.section(host, "时间");
    const toggle = (label, key) => {
      const wrap = el(host, "label", "ow-check");
      const box = el(wrap, "input");
      box.type = "checkbox";
      box.checked = this.p.data.clock[key];
      box.onchange = () => { this.p.data.clock[key] = box.checked; this.commit(); };
      el(wrap, "span", "", label);
    };
    toggle("显示日期那一行", "date");
    toggle("显示秒", "seconds");
  }

  renderQuote(host) {
    this.section(host, "每日一言", "一行一句。同一天里显示的是同一句，换日才换——按日期取，不是随机。");
    const area = el(host, "textarea", "ow-textarea");
    area.value = this.p.data.quote.lines.join("\n");
    area.rows = 6;
    area.setAttribute("aria-label", "语录，每行一句");
    area.onchange = () => {
      const lines = area.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 200);
      this.p.data.quote.lines = lines.length ? lines : core.DEFAULT_QUOTES.slice();
      area.value = this.p.data.quote.lines.join("\n");
      this.commit(lines.length ? "已保存" : "清空后恢复了默认几句");
    };
  }

  renderCountdown(host) {
    this.section(host, "倒计日", "自己填的日子。过去的日期也留着，会显示「已过 N 天」。");
    const list = el(host, "div", "ow-count-editor");
    const draw = () => {
      list.replaceChildren();
      this.p.data.countdown.items.forEach((item, index) => {
        const row = el(list, "div", "ow-count-edit-row");
        const name = el(row, "input", "ow-input");
        name.value = item.name;
        name.placeholder = "名称";
        name.setAttribute("aria-label", "倒计日名称");
        name.onchange = () => { item.name = name.value.trim().slice(0, 40); this.commit(); };
        const date = el(row, "input", "ow-input");
        date.type = "date";
        date.value = item.date;
        date.min = "0001-01-01";
        date.max = "9999-12-31";
        date.setAttribute("aria-label", "倒计日日期");
        date.onchange = () => {
          if (!core.validDate(date.value)) { date.value = item.date; new Notice("请选择有效日期。"); return; }
          item.date = date.value;
          this.commit();
        };
        btn(row, "删除", () => { this.p.data.countdown.items.splice(index, 1); draw(); this.commit("已删除"); }, "ow-quiet");
      });
      if (!this.p.data.countdown.items.length) el(list, "p", "ow-muted", "还没有倒计日。加一条，比如「期末考 · 2027-01-05」。");
    };
    draw();
    btn(host, "＋ 加一条", () => {
      if (this.p.data.countdown.items.length >= 20) { new Notice("最多 20 条。"); return; }
      this.p.data.countdown.items.push({ name: "新倒计日", date: day() });
      draw();
      this.commit();
    }, "ow-quiet");
    const max = el(host, "label", "ow-check");
    el(max, "span", "", "左栏最多显示");
    const count = el(max, "input", "ow-input ow-number");
    count.type = "number";
    count.min = "1";
    count.max = "8";
    count.value = String(this.p.data.countdown.max);
    count.setAttribute("aria-label", "左栏最多显示几条倒计日");
    count.onchange = () => {
      const value = Number(count.value);
      if (!Number.isInteger(value) || value < 1 || value > 8) { count.value = String(this.p.data.countdown.max); new Notice("请输入 1 到 8 之间的整数。"); return; }
      this.p.data.countdown.max = value;
      this.commit();
    };
    el(max, "span", "", "条");
  }

  renderWallpaper(host) {
    this.section(host, "背景", "用 Windows 桌面聚焦的图片当工作台背景，每天换一张。只读本地文件，不联网、不上传。可见度可以自己调；没开聚焦或读不到时自动退回原来的渐变。玻璃浓度调的是卡片有多透：拖到最清透，字也照样认得出。");
    const wrap = el(host, "label", "ow-check");
    const box = el(wrap, "input");
    box.type = "checkbox";
    box.checked = this.p.data.wallpaper.on;
    box.setAttribute("aria-label", "使用 Windows 聚焦图片作为背景");
    box.onchange = () => {
      this.p.data.wallpaper.on = box.checked;
      visibility.disabled = !box.checked;
      this.commit().then(() => this.p.applyWallpaper());
    };
    el(wrap, "span", "", "使用 Windows 聚焦图片");
    const level = el(host, "label", "ow-check ow-wallpaper-visibility");
    el(level, "span", "", "背景图可见度");
    const visibility = el(level, "input", "ow-wallpaper-range");
    visibility.type = "range";
    visibility.min = "0";
    visibility.max = "100";
    visibility.step = "1";
    visibility.value = String(this.p.data.wallpaper.visibility);
    visibility.disabled = !box.checked;
    visibility.setAttribute("aria-label", "背景图可见度百分比");
    const value = el(level, "output", "ow-wallpaper-value", `${visibility.value}%`);
    const preview = () => {
      const percent = core.wallpaperVisibility(visibility.value);
      this.p.data.wallpaper.visibility = percent;
      visibility.value = String(percent);
      value.textContent = `${percent}%`;
      this.p.applyWallpaperVisibility();
    };
    visibility.oninput = preview;
    visibility.onchange = () => { preview(); this.commit("背景可见度已保存"); };
    // 玻璃浓度不跟着「使用聚焦图片」那个勾走：没有壁纸时卡片也是玻璃，只是背后透的是渐变。
    const glass = el(host, "label", "ow-check ow-wallpaper-visibility");
    el(glass, "span", "", "玻璃浓度");
    el(glass, "span", "ow-range-end", "极清透");
    const tint = el(glass, "input", "ow-wallpaper-range");
    tint.type = "range";
    tint.min = "0";
    tint.max = "100";
    tint.step = "1";
    tint.value = String(core.glassTint(this.p.data.wallpaper.glassTint));
    tint.setAttribute("aria-label", "玻璃浓度：0 极清透，100 全着色");
    el(glass, "span", "ow-range-end", "全着色");
    const tintValue = el(glass, "output", "ow-wallpaper-value", `${tint.value}%`);
    const previewTint = () => {
      const percent = core.glassTint(tint.value);
      this.p.data.wallpaper.glassTint = percent;
      tint.value = String(percent);
      tintValue.textContent = `${percent}%`;
      this.p.applyGlassTint();
    };
    tint.oninput = previewTint;
    tint.onchange = () => { previewTint(); this.commit("玻璃浓度已保存"); };
    btn(host, "换一张", async () => {
      // 往后拨一格。此前这里只是把 wallpaperPath 清空再调一次 applyWallpaper，
      // 而挑图是 (列表, 日期) 的纯函数——同一天怎么算都是同一张。
      // 于是它重读了几 MB 的同一个文件、重建了一个 blob URL，界面一点没变，
      // 还弹「已换一张」：唯一真正生效的是那句谎话。
      const wallpaper = this.p.data.wallpaper;
      if (!wallpaper.on) { new Notice("背景没有开着"); return; }
      const before = this.p.wallpaperPath;
      wallpaper.shiftDay = day();
      wallpaper.shift = (Math.trunc(Number(wallpaper.shift)) || 0) + 1;
      this.p.applyWallpaper();
      if (!this.p.wallpaperPath) { new Notice("没找到可用的聚焦图片"); return; }
      if (this.p.wallpaperPath === before) { new Notice("聚焦缓存里只有这一张横版图"); return; }
      await this.commit("已换一张");
    }, "ow-quiet");
  }

  renderWeather(host) {
    this.section(host, "天气", "这是整个 Learning OS 唯一一处联网。请求发往 open-meteo.com，只带经纬度（降到两位小数，约 1 公里），不带任何标识，也不读库里的任何内容。");
    const field = (label, key, placeholder) => {
      const wrap = el(host, "label", "ow-check");
      el(wrap, "span", "", label);
      const input = el(wrap, "input", "ow-input");
      input.value = this.p.data.weather[key] === null ? "" : String(this.p.data.weather[key]);
      input.placeholder = placeholder;
      input.setAttribute("aria-label", label);
      return input;
    };
    const place = field("地名（只用于显示）", "place", "例如：米兰");
    place.onchange = () => { this.p.data.weather.place = place.value.trim().slice(0, 24); this.commit(); };
    const lat = field("纬度", "lat", "45.46");
    const lon = field("经度", "lon", "9.19");
    const applyCoords = () => {
      const a = core.roundCoord(lat.value), o = core.roundCoord(lon.value);
      if (a === null || o === null || Math.abs(a) > 90 || Math.abs(o) > 180) { new Notice("经纬度需要是数字，纬度 ±90、经度 ±180。"); return; }
      this.p.data.weather.lat = a;
      this.p.data.weather.lon = o;
      this.p.data.weather.cache = null;
      lat.value = String(a);
      lon.value = String(o);
      this.commit("坐标已保存").then(() => this.p.fetchWeather(true).catch((e) => new Notice(e.message)));
    };
    lat.onchange = applyCoords;
    lon.onchange = applyCoords;
    const minutes = field("刷新间隔（分钟）", "refreshMinutes", "60");
    minutes.type = "number";
    minutes.min = "10";
    minutes.max = "720";
    minutes.onchange = () => {
      const value = Number(minutes.value);
      if (!Number.isInteger(value) || value < 10 || value > 720) { minutes.value = String(this.p.data.weather.refreshMinutes); new Notice("请输入 10 到 720 之间的整数分钟。"); return; }
      this.p.data.weather.refreshMinutes = value;
      this.commit();
    };
    btn(host, "立即刷新", () => this.p.fetchWeather(true).then(() => this.commit("天气已更新")).catch((e) => new Notice(e.message)), "ow-quiet");
  }
}

module.exports = CodexWidgets;
