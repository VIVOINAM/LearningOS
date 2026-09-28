"use strict";

/**
 * 课表。数据只有一份：库里那篇 `type: timetable` 的笔记。
 *
 * 不另存一份 JSON。笔记是给人读、给人改的——调课了、换教室了，在 Obsidian 里
 * 改一行表格就算数；插件再存一份，两份一定会漂，而漂了之后没人知道该信哪一份。
 * 所以这里只做解析，表格的格式就是契约：「星期 | 时间 | 课程 | 教室 | 起始日期 | 结束日期」。
 *
 * 纯函数，不依赖 Obsidian，可直接 node --test。
 */

const WEEKDAYS = { 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 7, 周天: 7 };
const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const minutes = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
};
/** 周一 = 1 … 周日 = 7，和表格里的写法对齐（JS 的 getDay 周日是 0）。 */
const isoDay = (date) => (date.getDay() + 6) % 7 + 1;

/** 按 `|` 切一行表格，但不切 `\|`——课程格里是 `[[路径\|别名]]`。 */
function cells(line) {
  const text = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && text[i + 1] === "|") { cur += "|"; i++; continue; }
    if (text[i] === "|") { out.push(cur.trim()); cur = ""; continue; }
    cur += text[i];
  }
  out.push(cur.trim());
  return out;
}

/** 文中所有表格：[{header:[...], rows:[[...]]}]。分隔行（`| --- |`）用来认表头。 */
function tables(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const table = { header: cells(lines[i]), rows: [] };
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) table.rows.push(cells(lines[j]));
    out.push(table);
    i = j - 1;
  }
  return out;
}

function frontmatter(markdown) {
  const match = /^---\n([\s\S]*?)\n---/.exec(String(markdown || "").replace(/\r\n?/g, "\n"));
  const out = {};
  if (!match) return out;
  let last = "";
  for (const line of match[1].split("\n")) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) { last = kv[1]; out[last] = kv[2].trim().replace(/^["']|["']$/g, ""); continue; }
    // Obsidian 的属性面板把列表写成多行「  - 值」，接到上一个键后面。
    const item = /^\s+-\s*(.*)$/.exec(line);
    if (item && last) out[last] = [out[last], item[1].trim().replace(/^["']|["']$/g, "")].filter(Boolean).join(", ");
  }
  return out;
}

/** `[[03 知识库/…/086552 电工学|电工学]]` → {id:'086552', title:'电工学', link:'03 知识库/…/086552 电工学'} */
function course(cell) {
  const link = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(cell);
  const target = link ? link[1].trim() : "";
  const title = (link ? (link[2] || target.split("/").pop()) : cell).trim();
  const id = (/(?:^|[\s/])(\d{6})(?=\s|$)/.exec(target) || /(\d{6})/.exec(cell) || [])[1] || title;
  return { id, title: title.replace(/^\d{6}\s+/, ""), link: target };
}

const column = (header, ...names) => header.findIndex((h) => names.some((n) => h.includes(n)));

/**
 * 解析课表笔记。
 * 返回 {meta, slots, rooms, courses}；slots 里每一项是一个每周重复的时段。
 * 解析不了的行不丢——放进 skipped，由界面说出来，而不是安静地少一节课。
 */
function parseTimetable(markdown) {
  const meta = frontmatter(markdown);
  const slots = [];
  const skipped = [];
  const rooms = {};
  const courses = {};
  for (const table of tables(markdown)) {
    const h = table.header;
    // 「时间冲突」那张表也有星期、时间、课程三列，只是没有教室——靠教室这一列把两张表分开。
    const iDay = column(h, "星期"), iTime = column(h, "时间"), iCourse = column(h, "课程"), iRoom = column(h, "教室");
    if (iDay >= 0 && iTime >= 0 && iCourse >= 0 && iRoom >= 0) {
      const iFrom = column(h, "起始"), iTo = column(h, "结束");
      for (const row of table.rows) {
        const day = WEEKDAYS[row[iDay]];
        const time = /(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/.exec(row[iTime] || "");
        if (!day || !time) { skipped.push(row.join(" | ")); continue; }
        const date = (cell) => (/(\d{4}-\d{2}-\d{2})/.exec(cell || "") || [])[1] || "";
        const toCell = iTo >= 0 ? row[iTo] || "" : "";
        slots.push({
          day,
          start: time[1].padStart(5, "0"),
          end: time[2].padStart(5, "0"),
          course: course(row[iCourse] || ""),
          room: (row[iRoom] || "").trim(),
          from: iFrom >= 0 ? date(row[iFrom]) : "",
          to: date(toCell),
          // 「⚠ 待核实」这类标注原样带着：官方值可疑，但它仍是官方值。
          doubtful: /⚠|待核实/.test(toCell),
        });
      }
      continue;
    }
    const iCode = column(h, "代码"), iTeacher = column(h, "教师");
    if (iCode >= 0 && iTeacher >= 0) {
      const iName = column(h, "官方", "英文");
      for (const row of table.rows) {
        const id = (/(\d{6})/.exec(row[iCode] || "") || [])[1];
        if (id) courses[id] = { teacher: (row[iTeacher] || "").trim(), official: iName >= 0 ? (row[iName] || "").trim() : "" };
      }
      continue;
    }
    const iAddress = column(h, "地址");
    if (iRoom >= 0 && iAddress >= 0) {
      const iFloor = column(h, "楼层");
      for (const row of table.rows) {
        const place = { address: (row[iAddress] || "").trim(), floor: iFloor >= 0 ? (row[iFloor] || "").trim() : "" };
        for (const name of String(row[iRoom] || "").split(/[、,，]/)) if (name.trim()) rooms[name.trim()] = place;
      }
    }
  }
  // 可疑的结束日期按本学期其他课程的最晚结束日截断。静力学官方写的是 2027-12-20，
  // 照原值画，它会一直画进第二学期；原值留在 officialTo 里，界面上照样说出来。
  const trusted = slots.filter((s) => !s.doubtful && s.to).map((s) => s.to).sort();
  const semesterEnd = trusted[trusted.length - 1] || "";
  for (const slot of slots) {
    if (!slot.doubtful) continue;
    slot.officialTo = slot.to;
    if (semesterEnd && slot.to > semesterEnd) slot.to = semesterEnd;
  }
  slots.sort((a, b) => a.day - b.day || minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end));
  // 选了但不去上的课（只为考试资格）：frontmatter 里 `hidden_courses` 列出课程代码。
  // 官方表格原样留着——那是事实；不画它是个人的决定，所以写在 frontmatter 里，
  // 不去删表格的行。学期起止仍按全部时段算：隐藏一门课不该改变学期有多长。
  const hidden = new Set(String(meta.hidden_courses || "").match(/\d{6}/g) || []);
  const hiddenSlots = slots.filter((s) => hidden.has(s.course.id));
  return { meta, slots: slots.filter((s) => !hidden.has(s.course.id)), hiddenSlots, rooms, courses, skipped, semesterEnd };
}

/** 这个时段在这一天上不上课：星期对得上，且在起止日期之内。 */
function activeOn(slot, date) {
  const key = typeof date === "string" ? date : keyOf(date);
  const weekday = typeof date === "string" ? isoDay(new Date(`${date}T12:00:00`)) : isoDay(date);
  if (slot.day !== weekday) return false;
  if (slot.from && key < slot.from) return false;
  if (slot.to && key > slot.to) return false;
  return true;
}

/** 这一周的周一（本地时间，正午，避开夏令时切换那一小时）。 */
function mondayOf(date = new Date()) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (isoDay(d) - 1));
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * 一天之内的重叠分列。互相重叠的一簇时段并排成几列，每一项拿到 {lane, lanes}。
 * 贪心：按开始时间排，放进第一条已经空出来的列。
 */
function lanes(slots) {
  const sorted = [...slots].sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(b.end) - minutes(a.end));
  const out = [];
  let cluster = [], ends = [], clusterEnd = -1;
  const close = () => { for (const item of cluster) item.lanes = ends.length; cluster = []; ends = []; };
  for (const slot of sorted) {
    const s = minutes(slot.start), e = minutes(slot.end);
    if (s >= clusterEnd) { close(); clusterEnd = -1; }
    let lane = ends.findIndex((end) => end <= s);
    if (lane < 0) { lane = ends.length; ends.push(e); } else ends[lane] = e;
    const item = { slot, lane, lanes: 1 };
    cluster.push(item); out.push(item);
    clusterEnd = Math.max(clusterEnd, e);
  }
  close();
  return out;
}

/**
 * 一周的视图数据。周六周日只在那天真有课时出现。
 * 每一天：{key, weekday, label, date, items:[{slot, lane, lanes}]}。
 */
function weekView(slots, anyDate = new Date()) {
  const monday = mondayOf(anyDate);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(monday, i);
    const items = lanes(slots.filter((slot) => activeOn(slot, date)));
    const weekday = i + 1;
    if (weekday > 5 && !items.length) continue;
    days.push({ key: keyOf(date), weekday, label: WEEKDAY_LABELS[weekday], date, items });
  }
  return { monday: keyOf(monday), days, count: days.reduce((n, d) => n + d.items.length, 0) };
}

/** 时间轴的上下沿：取整到小时，并且至少覆盖 08–18。 */
function hourRange(slots) {
  if (!slots.length) return { first: 8, last: 18 };
  const first = Math.min(8, ...slots.map((s) => Math.floor(minutes(s.start) / 60)));
  const last = Math.max(18, ...slots.map((s) => Math.ceil(minutes(s.end) / 60)));
  return { first, last };
}

/** 学期第几周：以最早一节课所在那周为第 1 周。学期外返回 0。 */
function weekNumber(slots, anyDate = new Date()) {
  const starts = slots.map((s) => s.from).filter(Boolean).sort();
  const ends = slots.map((s) => s.to).filter(Boolean).sort();
  if (!starts.length) return 0;
  const first = mondayOf(new Date(`${starts[0]}T12:00:00`));
  const current = mondayOf(anyDate);
  const n = Math.round((current - first) / (7 * 86400000)) + 1;
  if (n < 1) return 0;
  if (ends.length && keyOf(current) > ends[ends.length - 1]) return 0;
  return n;
}

/**
 * 今天的课，每一节带一个状态：done 已结束 / now 进行中 / next 下一节 / later 之后。
 * 「下一节」只有一个——今天还没开始的里面最早的那节。
 */
function todayAgenda(slots, now = new Date()) {
  const current = now.getHours() * 60 + now.getMinutes();
  const list = slots.filter((slot) => activeOn(slot, now))
    .sort((a, b) => minutes(a.start) - minutes(b.start));
  let nextTaken = false;
  return list.map((slot) => {
    const s = minutes(slot.start), e = minutes(slot.end);
    let state = "later";
    if (current >= e) state = "done";
    else if (current >= s) state = "now";
    else if (!nextTaken) { state = "next"; nextTaken = true; }
    return { slot, state, startsIn: s - current, endsIn: e - current };
  });
}

/** 从现在起的下一节课（最多往后看 21 天），{slot, date, key, startsIn(分钟)}；没有返回 null。 */
function nextClass(slots, now = new Date()) {
  const current = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < 21; i++) {
    const date = addDays(now, i);
    const candidates = slots.filter((slot) => activeOn(slot, date) && (i > 0 || minutes(slot.start) > current))
      .sort((a, b) => minutes(a.start) - minutes(b.start));
    if (candidates.length) {
      const slot = candidates[0];
      return { slot, date, key: keyOf(date), inDays: i, startsIn: i * 1440 + minutes(slot.start) - current };
    }
  }
  return null;
}

/** 同一天里互相重叠的两节课：[{day, start, end, a, b}]。 */
function conflicts(slots) {
  const out = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      if (a.day !== b.day) continue;
      const s = Math.max(minutes(a.start), minutes(b.start)), e = Math.min(minutes(a.end), minutes(b.end));
      if (s >= e) continue;
      // 起止日期完全不相交的两段不算冲突：它们从不在同一周出现。
      if (a.to && b.from && a.to < b.from) continue;
      if (b.to && a.from && b.to < a.from) continue;
      const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      out.push({ day: a.day, start: hhmm(s), end: hhmm(e), a, b });
    }
  }
  return out;
}

/**
 * 课程配色的序号，1 起。按课程代码的字典序分配，而不是按出现顺序——
 * 表格改一行顺序，颜色不该跟着换。
 */
function palette(slots, size = 6) {
  const ids = [...new Set(slots.map((s) => s.course.id))].sort();
  return new Map(ids.map((id, i) => [id, (i % size) + 1]));
}

/** 「还有 35 分钟」「还有 2 小时 10 分」「明天 08:15」这一类相对说法。 */
function relative(next) {
  if (!next) return "";
  if (next.inDays === 0) {
    const m = next.startsIn;
    if (m < 60) return `${m} 分钟后`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} 小时 ${r} 分后` : `${h} 小时后`;
  }
  if (next.inDays === 1) return `明天 ${next.slot.start}`;
  return `${WEEKDAY_LABELS[next.slot.day]} ${next.slot.start}`;
}

module.exports = {
  WEEKDAY_LABELS, minutes, isoDay, keyOf, cells, tables, parseTimetable, activeOn, mondayOf, addDays,
  lanes, weekView, hourRange, weekNumber, todayAgenda, nextClass, conflicts, palette, relative,
};
