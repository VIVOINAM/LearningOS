"use strict";

/**
 * 挂件的全部判断都在这里，没有一行碰 DOM 或网络。
 *
 * 分出来的理由和 timer-core 一样：「还有几天」「今天该显示哪一句」这种事
 * 一旦写在渲染函数里，就只能靠开着 Obsidian 盯屏幕来验证。跨年、跨月、
 * 夏令时、只有一条语录、语录被删空——这些情况不会在你盯屏幕的那天发生。
 */

const { day } = require("../../shared/date");

/** 四个挂件的固定顺序上限：id 不在这张表里的一律丢弃，避免旧数据带进未知项。 */
const KINDS = ["clock", "quote", "countdown", "weather"];
const LABELS = { clock: "时间", quote: "每日一言", countdown: "倒计日", weather: "天气" };

// 默认语录全部取自公有领域的古籍，不带出处争议，也不需要联网拉取。
// 你可以在设置里整段替换——这几条只是让第一次打开时不是一片空白。
const DEFAULT_QUOTES = [
  "不积跬步，无以至千里。——《荀子》",
  "学而不思则罔，思而不学则殆。——《论语》",
  "知之者不如好之者，好之者不如乐之者。——《论语》",
  "博学之，审问之，慎思之，明辨之，笃行之。——《中庸》",
  "业精于勤，荒于嬉；行成于思，毁于随。——韩愈",
  "读书之法，在循序而渐进，熟读而精思。——朱熹",
  "路漫漫其修远兮，吾将上下而求索。——屈原",
];

const clamp = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const wallpaperVisibility = (value) => clamp(value, 0, 100, 14);

/** 合法的 YYYY-MM-DD，并且真的存在这一天（2026-02-30 不算）。 */
function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "";
  const [, y, m, d] = match.map(Number);
  const probe = new Date(y, m - 1, d, 12, 0, 0, 0);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d ? value : "";
}

/**
 * 相差几天。两端都取当天正午再相减——取零点会在夏令时切换的那一周
 * 少算或多算一天，而倒计日恰恰是那种差一天就没意义的东西。
 */
function daysUntil(dateString, now = Date.now()) {
  if (!validDate(dateString)) return null;
  const [y, m, d] = dateString.split("-").map(Number);
  const target = new Date(y, m - 1, d, 12, 0, 0, 0);
  const today = new Date(now);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  return Math.round((target - base) / 86400000);
}

/** 天数 -> 人话。过去的日子也留着：纪念日和截止日用同一个挂件。 */
function countdownLabel(days) {
  if (days === null) return "日期无效";
  if (days === 0) return "就是今天";
  if (days === 1) return "明天";
  if (days === -1) return "昨天";
  return days > 0 ? `还有 ${days} 天` : `已过 ${-days} 天`;
}

/**
 * 按日期散列出一个下标。语录和壁纸共用这一套——
 * 随机的话每次刷新工作台都换，「每日一言」会变成「每秒一言」。
 */
function dayIndex(key, count) {
  if (!(count > 0)) return -1;
  let hash = 0;
  for (const ch of String(key)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % count;
}

/** 今天显示哪一句。 */
function pickQuote(lines, key = day()) {
  const pool = (Array.isArray(lines) ? lines : []).map(text).filter(Boolean);
  const at = dayIndex(key, pool.length);
  return at < 0 ? "" : pool[at];
}

/**
 * 从 JPEG 文件头里读出宽高。
 *
 * Windows 聚焦把横版壁纸和竖版（手机用）混在同一堆文件里，文件名只有一串数字，
 * 绝大多数连尺寸后缀都没有——不解析就分不出哪张能用。
 *
 * 只认 SOF 段（0xFFC0–0xFFCF，跳过 C4/C8/CC 这三个不是 SOF 的）。
 * 传进来的可以只是文件开头几十 KB：SOF 一定在图像数据之前。
 */
function jpegSize(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
  let i = 2;
  while (i < buffer.length - 8) {
    if (buffer[i] !== 0xFF) { i += 1; continue; }
    const marker = buffer[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    const length = buffer.readUInt16BE(i + 2);
    if (!(length > 0)) return null;   // 段长为 0 会原地死循环
    i += 2 + length;
  }
  return null;
}

/** 够宽、是横版，才当得了背景。竖版是手机壁纸，铺开会糊成一团。 */
function usableWallpaper(size) {
  return !!size && size.width > size.height && size.width >= 1000;
}

/**
 * 今天用哪一张。列表先按路径排序再取，是为了让同一天多次打开拿到同一张——
 * 目录读出来的顺序不保证稳定。
 *
 * shift 是「手动换一张」用的偏移量。在这之前它不存在，于是那个按钮只能
 * 清掉插件里「当前是哪张」的记忆再调一遍——而这个函数是 (列表, 日期) 的
 * 纯函数，同一天怎么算都是同一张。按钮重读了几 MB 的同一个文件，
 * 重新建了一个 blob URL，界面一点没变，还弹「已换一张」。
 *
 * 偏移在池子里绕圈，所以按到底会回到起点，不会有「换不动了」的死角。
 */
function pickWallpaper(paths, key = day(), shift = 0) {
  const pool = (Array.isArray(paths) ? paths : []).filter(Boolean).slice().sort();
  const at = dayIndex(key, pool.length);
  if (at < 0) return "";
  const step = Math.trunc(Number(shift)) || 0;
  return pool[(((at + step) % pool.length) + pool.length) % pool.length];
}

/**
 * 当前该用的偏移量。手动挑的那张只在当天有效：第二天回到「今天该是哪张」，
 * 否则今天往后拨的三张会永久跟着你，而「每天换一张」就成了「每天换一张、
 * 但永远差三格」——一个没人能解释的状态。
 */
function wallpaperShift(wallpaper = {}, key = day()) {
  if (!wallpaper || wallpaper.shiftDay !== key) return 0;
  return Math.trunc(Number(wallpaper.shift)) || 0;
}

/**
 * 二十四小时制，小时补零。7.0 起没有第二种。
 *
 * 6.4 最初把「上午 」拼在前面，结果在 196px 的左栏里「上午 7:55:50」放不下，
 * 27px 的大字折成两行、卡片从 62px 长到 99px，四个挂件加起来溢出 11px，
 * 挂件区冒出一条滚动条。时段是限定语，不该和读数抢同一行的宽度。
 *
 * 7.0 把十二小时制这个开关也删了，同一个理由的另一面：**补零和时段是一件事**。
 * 时钟用 --os-serif 那支高反差衬线展示号，十二小时制不补零，于是 9:59 跳到
 * 10:00 的那一刻读数宽一位——196px 的固定左栏、27px 的大字，那是看得见的抖动。
 * 一个读数不该因为到了整点就改变自己占的宽度。
 *
 * 旧数据里的 clock.hour12 由 normalize 直接丢掉，不需要迁移代码。
 */
function clockText(date, { seconds = false } = {}) {
  const pad = (n) => String(n).padStart(2, "0");
  const parts = [pad(date.getHours()), pad(date.getMinutes())];
  if (seconds) parts.push(pad(date.getSeconds()));
  return parts.join(":");
}

function dateText(date) {
  return date.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
}

// WMO 天气代码表。Open-Meteo 返回的是这套编号，不是文字。
const WMO = [
  [[0], "晴"], [[1], "大致晴朗"], [[2], "多云"], [[3], "阴"],
  [[45, 48], "雾"], [[51, 53, 55], "毛毛雨"], [[56, 57], "冻毛毛雨"],
  [[61, 63, 65], "雨"], [[66, 67], "冻雨"], [[71, 73, 75], "雪"], [[77], "雪粒"],
  [[80, 81, 82], "阵雨"], [[85, 86], "阵雪"], [[95], "雷阵雨"], [[96, 99], "雷阵雨伴冰雹"],
];

// 同一套 WMO 码的图标名。页头那一行只有一行高，靠一个字形比靠「多云」两个字快。
// 用的是 Obsidian 内置的 lucide 名，拿不到 setIcon 时整段跳过，不留空位。
const WMO_ICON = [
  [[0], "sun"], [[1], "cloud-sun"], [[2], "cloud"], [[3], "cloudy"],
  [[45, 48], "cloud-fog"], [[51, 53, 55, 56, 57], "cloud-drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "cloud-rain"],
  [[71, 73, 75, 77, 85, 86], "cloud-snow"],
  [[95], "cloud-lightning"], [[96, 99], "cloud-hail"],
];

function weatherIcon(code) {
  const hit = WMO_ICON.find(([codes]) => codes.includes(Number(code)));
  return hit ? hit[1] : "cloud";
}

/**
 * 自绘图标画哪一幕。和 WMO_ICON 一一对应，分组也一样——
 * 两张表分不开：lucide 那套是退路，退路和正路必须画的是同一件事，
 * 否则「画不出来就退回 lucide」会在某些天气下换掉图的含义。
 * weatherScenesCoverIcons() 把这一点钉死。
 *
 * 为什么是 id 而不是 SVG 字符串：core 不碰 DOM（见文件头）。图形由 main.js
 * 用 createElementNS 建，这里只回答「画哪一幕」。顺带也避开 innerHTML。
 */
const WMO_SCENE = [
  [[0], "sun"], [[1], "sun-cloud"], [[2], "cloud"], [[3], "overcast"],
  [[45, 48], "fog"], [[51, 53, 55, 56, 57], "drizzle"],
  [[61, 63, 65, 66, 67, 80, 81, 82], "rain"],
  [[71, 73, 75, 77, 85, 86], "snow"],
  [[95], "thunder"], [[96, 99], "hail"],
];

const SCENES = WMO_SCENE.map(([, id]) => id);

function weatherScene(code) {
  const hit = WMO_SCENE.find(([codes]) => codes.includes(Number(code)));
  return hit ? hit[1] : "cloud";
}

/** 两张表的分组必须逐组相同。测试拿它当断言，不是拿来运行时判的。 */
function weatherScenesCoverIcons() {
  if (WMO_SCENE.length !== WMO_ICON.length) return false;
  return WMO_SCENE.every(([codes], i) =>
    codes.length === WMO_ICON[i][0].length && codes.every((c, j) => c === WMO_ICON[i][0][j]));
}

/**
 * 图标该不该动。
 *
 * 三条里最要紧的是 stale：缓存过期、取数失败、没填坐标的时候，读数其实
 * 是旧的，而一个还在下雨的图标会让人以为它是刚取回来的。**用动效表达一个
 * 没更新的读数，就是用展示效果编数据**——协作规则第四条挡的正是这件事。
 *
 * reduced 走 prefers-reduced-motion；hidden 走文档可见性：窗口不在前台时
 * 不必让合成器一直转，6.6.1 那一轮刚为同类开销付过账。
 */
function weatherAnimated({ stale = false, reduced = false, hidden = false } = {}) {
  return !stale && !reduced && !hidden;
}

function weatherText(code) {
  const hit = WMO.find(([codes]) => codes.includes(Number(code)));
  return hit ? hit[1] : "未知天气";
}

/** 缓存过期没有。没坐标、没缓存、超过间隔都算该重新取。 */
function weatherStale(cache, refreshMinutes, now = Date.now()) {
  if (!cache || !Number.isFinite(Number(cache.at))) return true;
  return now - Number(cache.at) >= Math.max(1, Number(refreshMinutes) || 60) * 60000;
}

/**
 * Number(null)、Number('')、Number([]) 全是 0，而 0 是一个合法纬度、也是一个
 * 合法气温。这一层不加，没填过坐标的全新安装会去查 0,0 点的天气，
 * 接口少返回一个字段则显示成「0°」。
 */
function numberOrNull(value) {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 坐标降到两位小数再出门。两位约合 1 公里，足够查天气，
 * 但不足以指出你坐在哪栋楼里——这是这个插件唯一一处对外发请求的地方。
 */
function roundCoord(value) {
  const n = numberOrNull(value);
  return n === null ? null : Math.round(n * 100) / 100;
}

function weatherUrl({ lat, lon }) {
  const a = roundCoord(lat), o = roundCoord(lon);
  if (a === null || o === null || Math.abs(a) > 90 || Math.abs(o) > 180) return "";
  return `https://api.open-meteo.com/v1/forecast?latitude=${a}&longitude=${o}&current=temperature_2m,weather_code&timezone=auto`;
}

/** 把 Open-Meteo 的响应收成缓存条目；字段缺一个就当没取到。 */
function weatherFromResponse(body, now = Date.now()) {
  const current = body && typeof body === "object" ? body.current : null;
  if (!current) return null;
  // 同样躲 Number(null)===0：字段缺失时气温会变成一个看起来很正常的 0 度。
  const temp = numberOrNull(current.temperature_2m), code = numberOrNull(current.weather_code);
  if (temp === null || code === null) return null;
  return { at: now, temp: Math.round(temp), code };
}

function normalizeCountdownItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ name: text(item?.name).slice(0, 40), date: validDate(item?.date) }))
    .filter((item) => item.name && item.date)
    .slice(0, 20);
}

/**
 * 挂件顺序与开关。写成一个数组而不是 {clock:true,...}，
 * 因为顺序也是设置的一部分——拖动排序时不必再存第二份字段。
 */
/**
 * 挂件能去的三个地方。
 *
 * top / bottom 在左栏，分别是导航上方和下方；header 是今日页标题那一行的右端。
 * 三档而不是两档的理由是天气：它一行就说完（17° 多云 · 米兰），塞进左栏得竖着摆成
 * 一张 85px 的卡，而页头那一行本来就空着一大段。
 */
const SLOTS = ["top", "bottom", "header"];
const SLOT_LABELS = { top: "导航上", bottom: "导航下", header: "页头" };

// 时间在左栏顶部——那是视线第一个落点，而时间是一眼扫过去就要读到的东西。
// 语录和倒计日是「有空才看」，留在导航下方那段空档。天气去页头，横着排。
const DEFAULT_SLOT = { clock: "top", quote: "bottom", countdown: "bottom", weather: "header" };
const DEFAULT_ON = { clock: true, quote: true, countdown: true, weather: false };
const DEFAULT_ORDER = KINDS.map((id) => ({ id, on: DEFAULT_ON[id], slot: DEFAULT_SLOT[id] }));

// 6.4 早期只有两档，用一个 top 布尔存，默认值是这张表。
const LEGACY_TOP = { clock: true, quote: false, countdown: false, weather: false };

/**
 * 认三种写法：现在的 slot 字符串、早期的 top 布尔、以及都没有的最早那版。
 * 迁移在读的时候做，不写迁移脚本——这份数据小到重算一遍比维护一段迁移代码便宜。
 *
 * top 布尔那一档要分清「用户按过按钮」和「这只是当时的默认值」：
 * 天气当时默认 top:false，照字面迁移就是 bottom，可它从来不是谁选的——
 * 三档之后天气的默认位置是页头，那条存档该走新默认，而不是被一个没人做过的
 * 选择钉在左栏里。只有和当时默认不同的值才是真的选择，那种才照搬。
 */
function slotOf(entry, id) {
  if (SLOTS.includes(entry?.slot)) return entry.slot;
  if (typeof entry?.top === "boolean" && entry.top !== LEGACY_TOP[id]) return entry.top ? "top" : "bottom";
  return DEFAULT_SLOT[id];
}

function normalizeOrder(value) {
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!KINDS.includes(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, on: entry?.on !== false, slot: slotOf(entry, id) });
  }
  // 一项都认不出来（空数组、整段损坏）就退回默认，而不是交出一个四项全关的侧栏——
  // 那种状态下界面上没有任何入口能改回来。
  if (!seen.size) return DEFAULT_ORDER.map((entry) => ({ ...entry }));
  // 数据里没提到的挂件补在末尾，默认关闭：新增一个挂件不该在所有人的侧栏里自己冒出来。
  for (const id of KINDS) if (!seen.has(id)) out.push({ id, on: false, slot: DEFAULT_SLOT[id] });
  return out;
}

function normalize(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const quote = source.quote || {};
  const weather = source.weather || {};
  const clock = source.clock || {};
  const lines = Array.isArray(quote.lines) ? quote.lines.map(text).filter(Boolean) : null;
  return {
    schemaVersion: 1,
    // 第一次安装：时间和每日一言开着，倒计日和天气等你填了内容再说。
    order: normalizeOrder(source.order),
    clock: { seconds: clock.seconds === true, date: clock.date !== false },
    quote: { lines: lines && lines.length ? lines.slice(0, 200) : DEFAULT_QUOTES.slice() },
    countdown: { items: normalizeCountdownItems(source.countdown?.items), max: clamp(source.countdown?.max, 1, 8, 3) },
    // 默认开：用户要的就是这个。读不到聚焦目录时自己退回渐变，不会留下坏掉的界面。
    wallpaper: {
      on: source.wallpaper?.on !== false,
      visibility: wallpaperVisibility(source.wallpaper?.visibility),
      // 手动换一张的偏移，连同它属于哪一天。跨日作废，见 wallpaperShift。
      shift: clamp(source.wallpaper?.shift, 0, 999, 0),
      shiftDay: text(source.wallpaper?.shiftDay).slice(0, 10),
    },
    weather: {
      lat: roundCoord(weather.lat),
      lon: roundCoord(weather.lon),
      place: text(weather.place).slice(0, 24),
      refreshMinutes: clamp(weather.refreshMinutes, 10, 720, 60),
      cache: weather.cache && Number.isFinite(Number(weather.cache.at)) ? { at: Number(weather.cache.at), temp: Number(weather.cache.temp), code: Number(weather.cache.code) } : null,
    },
  };
}

/**
 * 排好序、已启用、有内容可显示、并且属于这个槽位的挂件。
 * slot 省略时返回全部三个槽位——测试和「一个都没开吗」这种判断用得上。
 */
function activeWidgets(data, slot) {
  return data.order
    .filter((entry) => entry.on)
    .filter((entry) => slot === undefined || entry.slot === slot)
    .filter((entry) => {
      if (entry.id === "countdown") return data.countdown.items.length > 0;
      if (entry.id === "quote") return data.quote.lines.length > 0;
      if (entry.id === "weather") return weatherUrl(data.weather) !== "";
      return true;
    })
    .map((entry) => entry.id);
}

/** 倒计日按「离今天多近」排，已经过去的排在最后。 */
function sortedCountdowns(items, now = Date.now()) {
  return items
    .map((item) => ({ ...item, days: daysUntil(item.date, now) }))
    .sort((a, b) => (a.days < 0) - (b.days < 0) || Math.abs(a.days) - Math.abs(b.days));
}

module.exports = {
  KINDS, LABELS, DEFAULT_QUOTES, DEFAULT_SLOT, SLOTS, SLOT_LABELS,
  normalize, normalizeOrder, normalizeCountdownItems, activeWidgets,
  validDate, daysUntil, countdownLabel, sortedCountdowns,
  pickQuote, dayIndex, clockText, dateText,
  jpegSize, usableWallpaper, pickWallpaper, wallpaperShift, wallpaperVisibility,
  weatherText, weatherIcon, weatherScene, weatherScenesCoverIcons, weatherAnimated, SCENES,
  weatherStale, weatherUrl, weatherFromResponse, roundCoord,
};
