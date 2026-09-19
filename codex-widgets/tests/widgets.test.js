"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../core/widgets');

test('倒计日：跨年、跨夏令时、无效日期', () => {
  const now = new Date(2026, 8, 19, 23, 30).getTime(); // 9-19 深夜，最容易差一天的时刻
  assert.equal(core.daysUntil('2026-09-19', now), 0);
  assert.equal(core.daysUntil('2026-09-20', now), 1);
  assert.equal(core.daysUntil('2026-09-18', now), -1);
  assert.equal(core.daysUntil('2027-01-05', now), 108);
  // 夏令时切换周：欧洲 10-25 回拨一小时，按零点相减会算成 107.96 天再取整出错。
  assert.equal(core.daysUntil('2026-10-26', now), 37);
  assert.equal(core.daysUntil('2026-02-30', now), null, '2 月没有 30 号');
  assert.equal(core.daysUntil('不是日期', now), null);
  assert.equal(core.countdownLabel(0), '就是今天');
  assert.equal(core.countdownLabel(-3), '已过 3 天');
  assert.equal(core.countdownLabel(null), '日期无效');
});

test('倒计日排序：离今天近的在前，过去的沉到最后', () => {
  const now = new Date(2026, 8, 19, 12).getTime();
  const sorted = core.sortedCountdowns([
    {name:'远的', date:'2026-12-01'}, {name:'昨天', date:'2026-09-18'},
    {name:'后天', date:'2026-09-21'}, {name:'很久以前', date:'2026-01-01'},
  ], now);
  assert.deepEqual(sorted.map(x => x.name), ['后天','远的','昨天','很久以前']);
});

test('每日一言：同一天同一句，换日才换，空池返回空串', () => {
  const lines = ['甲','乙','丙','丁'];
  assert.equal(core.pickQuote(lines, '2026-09-19'), core.pickQuote(lines, '2026-09-19'));
  const week = new Set(['2026-09-19','2026-09-20','2026-09-21','2026-09-22'].map(k => core.pickQuote(lines, k)));
  assert.ok(week.size > 1, '连续几天不该是同一句');
  assert.equal(core.pickQuote([], '2026-09-19'), '');
  assert.equal(core.pickQuote(['  '], '2026-09-19'), '', '只有空白的一行不算一句');
});

test('时钟文本：补零、十二小时制、秒；时段不占读数那一行', () => {
  const morning = new Date(2026, 8, 19, 9, 5, 7);
  assert.equal(core.clockText(morning), '09:05');
  assert.equal(core.clockText(morning, {seconds:true}), '09:05:07');
  assert.equal(core.clockText(morning, {hour12:true}), '9:05', '上午/下午不进这个字符串——196px 的左栏放不下');
  assert.equal(core.clockText(new Date(2026, 8, 19, 0, 0), {hour12:true}), '12:00', '零点是 12 点，不是 0 点');
  assert.equal(core.clockText(new Date(2026, 8, 19, 13, 0), {hour12:true}), '1:00');
  assert.equal(core.clockText(new Date(2026, 8, 19, 13, 0), {hour12:true, seconds:true}), '1:00:00');
  assert.equal(core.meridiem(morning, {hour12:true}), '上午');
  assert.equal(core.meridiem(new Date(2026, 8, 19, 12, 0), {hour12:true}), '下午', '正午算下午');
  assert.equal(core.meridiem(morning), '', '二十四小时制不显示时段');
});

test('天气：坐标降精度、越界拒绝、WMO 码翻译、缓存过期', () => {
  assert.match(core.weatherUrl({lat:45.4642035, lon:9.189982}), /latitude=45\.46&longitude=9\.19/);
  assert.ok(!core.weatherUrl({lat:45.46, lon:9.19}).includes('45.4642'), '完整精度的坐标不许出门');
  assert.equal(core.weatherUrl({lat:91, lon:9}), '', '纬度越界');
  assert.equal(core.weatherUrl({lat:null, lon:null}), '');
  assert.equal(core.weatherText(0), '晴');
  assert.equal(core.weatherText(95), '雷阵雨');
  assert.equal(core.weatherText(999), '未知天气');
  assert.equal(core.weatherIcon(0), 'sun');
  assert.equal(core.weatherIcon(65), 'cloud-rain');
  assert.equal(core.weatherIcon(999), 'cloud', '认不出的码给一朵云，不给空字符串——页头会留一个空位');
  const now = Date.now();
  assert.equal(core.weatherStale(null, 60, now), true);
  assert.equal(core.weatherStale({at: now - 10 * 60000}, 60, now), false);
  assert.equal(core.weatherStale({at: now - 61 * 60000}, 60, now), true);
  assert.deepEqual(core.weatherFromResponse({current:{temperature_2m:18.6, weather_code:3}}, 5), {at:5, temp:19, code:3});
  assert.equal(core.weatherFromResponse({current:{temperature_2m:null, weather_code:3}}), null);
  assert.equal(core.weatherFromResponse('502 Bad Gateway'), null, '接口挂了返回的不是 JSON');
});

test('normalize：脏数据不会产出一个四项全关的侧栏', () => {
  assert.deepEqual(core.normalizeOrder([]).map(e => e.id), core.KINDS);
  assert.ok(core.normalizeOrder([]).some(e => e.on), '空 order 必须退回默认，否则界面上没有入口改回来');
  assert.deepEqual(core.normalizeOrder(['weather','不存在的','weather','clock']).map(e => e.id), ['weather','clock','quote','countdown']);
  assert.deepEqual(core.normalizeOrder(['weather']).filter(e => e.on).map(e => e.id), ['weather'], '没提到的挂件默认关闭');
  const data = core.normalize({quote:{lines:[]}, countdown:{items:[{name:'期末考', date:'2026-13-99'}, {name:'', date:'2026-01-01'}]}, weather:{lat:'abc', refreshMinutes:99999}});
  assert.deepEqual(data.quote.lines, core.DEFAULT_QUOTES, '语录被清空时恢复默认');
  assert.deepEqual(data.countdown.items, [], '名称或日期不合法的条目整条丢掉');
  assert.equal(data.weather.lat, null);
  assert.equal(data.weather.refreshMinutes, 720, '刷新间隔封顶');
  assert.equal(core.normalize(null).schemaVersion, 1);
  assert.equal(core.normalize(undefined).clock.date, true);
});

const slotOf = (data, id) => data.order.find(e => e.id === id).slot;

test('槽位：三档默认值', () => {
  const fresh = core.normalize(null);
  assert.equal(slotOf(fresh, 'clock'), 'top');
  assert.equal(slotOf(fresh, 'quote'), 'bottom');
  assert.equal(slotOf(fresh, 'countdown'), 'bottom');
  assert.equal(slotOf(fresh, 'weather'), 'header', '天气一行就说完，默认去页头');
  assert.deepEqual(core.SLOTS, ['top','bottom','header']);
});

test('槽位迁移：认得三种写法，且分得清「选过」和「只是当时的默认」', () => {
  // 最早那版：连位置字段都没有，全部走当前默认表。
  const earliest = core.normalize({order:[{id:'clock',on:true},{id:'weather',on:true}]});
  assert.equal(slotOf(earliest, 'clock'), 'top');
  assert.equal(slotOf(earliest, 'weather'), 'header');

  // 两档那版用 top 布尔存，默认是 clock:true、其余 false。
  // 天气的 false 从来不是谁选的，是当时的默认值——照字面迁成 bottom 就等于
  // 把一个没人做过的选择钉死，所以它该走新默认（页头）。
  const legacyDefault = core.normalize({order:[
    {id:'clock',on:true,top:true},{id:'quote',on:true,top:false},
    {id:'countdown',on:true,top:false},{id:'weather',on:true,top:false},
  ]});
  assert.equal(slotOf(legacyDefault, 'weather'), 'header', '没人动过的默认值不该被钉在左栏');
  assert.equal(slotOf(legacyDefault, 'clock'), 'top');
  assert.equal(slotOf(legacyDefault, 'quote'), 'bottom');

  // 和当时默认不同的值才是真的选择，那种照搬。
  const chosen = core.normalize({order:[
    {id:'clock',on:true,top:false},{id:'quote',on:true,top:true},{id:'weather',on:true,top:true},
  ]});
  assert.equal(slotOf(chosen, 'clock'), 'bottom', '把时间挪下去是个反向选择，要保住');
  assert.equal(slotOf(chosen, 'quote'), 'top');
  assert.equal(slotOf(chosen, 'weather'), 'top', '真把天气挪上去过，就别自作主张搬去页头');

  // 现在这版：slot 字符串说了算，不认识的值退回默认。
  const now = core.normalize({order:[{id:'weather',on:true,slot:'bottom'},{id:'clock',on:true,slot:'侧边'}]});
  assert.equal(slotOf(now, 'weather'), 'bottom');
  assert.equal(slotOf(now, 'clock'), 'top', '槽位名不认识就当没写');
});

test('activeWidgets 按槽位分流，顺序在每一段内部各自保持', () => {
  const data = core.normalize({order:[
    {id:'weather',on:true,slot:'top'},{id:'clock',on:true,slot:'top'},
    {id:'countdown',on:true,slot:'bottom'},{id:'quote',on:true,slot:'bottom'},
  ]});
  data.countdown.items = [{name:'期末考', date:'2027-01-05'}];
  data.weather.lat = 45.46; data.weather.lon = 9.19;
  assert.deepEqual(core.activeWidgets(data, 'top'), ['weather','clock']);
  assert.deepEqual(core.activeWidgets(data, 'bottom'), ['countdown','quote']);
  assert.deepEqual(core.activeWidgets(data), ['weather','clock','countdown','quote'], '省略槽位时给出全部');
  // 空的倒计日在分槽之后同样不占位置——两条规则要叠加，不是二选一。
  data.countdown.items = [];
  assert.deepEqual(core.activeWidgets(data, 'bottom'), ['quote']);
});

test('JPEG 尺寸：只认 SOF，坏数据返回 null 而不是死循环', () => {
  // 最小可用的 JPEG 头：SOI + SOF0(0xC0)，段内 precision/height/width。
  const sof = (marker, w, h) => {
    const b = Buffer.from([0xFF,0xD8, 0xFF,marker, 0x00,0x11, 0x08, h>>8,h&255, w>>8,w&255]);
    return b;
  };
  assert.deepEqual(core.jpegSize(sof(0xC0, 3840, 2160)), {width:3840, height:2160});
  assert.deepEqual(core.jpegSize(sof(0xC2, 1462, 914)), {width:1462, height:914}, '渐进式 JPEG 也是 SOF');
  // C4 是霍夫曼表，不是 SOF——照着读会把表长当成宽高。
  assert.equal(core.jpegSize(Buffer.from([0xFF,0xD8, 0xFF,0xC4, 0x00,0x04, 0,0])), null);
  assert.equal(core.jpegSize(Buffer.from([1,2,3,4])), null, '不是 JPEG');
  assert.equal(core.jpegSize(null), null);
  // 段长为 0 会让指针原地不动。没有那道防线，这一行就是个死循环。
  assert.equal(core.jpegSize(Buffer.alloc(64, 0).fill(Buffer.from([0xFF,0xD8,0xFF,0xE0,0x00,0x00]), 0, 6)), null);
});

test('壁纸筛选：竖版和小图都排除', () => {
  assert.equal(core.usableWallpaper({width:3840, height:2160}), true);
  assert.equal(core.usableWallpaper({width:1462, height:914}), true);
  assert.equal(core.usableWallpaper({width:1080, height:1920}), false, '竖版是手机壁纸');
  assert.equal(core.usableWallpaper({width:800, height:600}), false, '太小，铺开会糊');
  assert.equal(core.usableWallpaper(null), false);
});

test('壁纸可见度：默认 14%，并限制在 0–100%', () => {
  assert.equal(core.normalize(null).wallpaper.visibility, 14);
  assert.equal(core.normalize({wallpaper:{visibility:37}}).wallpaper.visibility, 37);
  assert.equal(core.normalize({wallpaper:{visibility:-20}}).wallpaper.visibility, 0);
  assert.equal(core.normalize({wallpaper:{visibility:180}}).wallpaper.visibility, 100);
  assert.equal(core.normalize({wallpaper:{visibility:'坏数据'}}).wallpaper.visibility, 14);
});

test('壁纸按日取：同一天同一张，与目录读出的顺序无关', () => {
  const a = ['/c/3.jpg','/c/1.jpg','/c/2.jpg'];
  const b = ['/c/2.jpg','/c/3.jpg','/c/1.jpg'];
  // 目录遍历的顺序不保证稳定，所以取之前先排序——否则同一天两次打开可能是两张图。
  assert.equal(core.pickWallpaper(a,'2026-09-19'), core.pickWallpaper(b,'2026-09-19'));
  const week = new Set(['2026-09-19','2026-09-20','2026-09-21','2026-09-22'].map(k=>core.pickWallpaper(a,k)));
  assert.ok(week.size>1, '连续几天不该是同一张');
  assert.equal(core.pickWallpaper([],'2026-09-19'), '');
  assert.equal(core.pickWallpaper(null,'2026-09-19'), '');
});

test('activeWidgets：开着但没内容的挂件不占位置', () => {
  const data = core.normalize({order:[{id:'clock',on:true},{id:'countdown',on:true},{id:'weather',on:true},{id:'quote',on:true}]});
  assert.deepEqual(core.activeWidgets(data), ['clock','quote'], '倒计日为空、天气没坐标，都不画');
  data.countdown.items = [{name:'期末考', date:'2027-01-05'}];
  data.weather.lat = 45.46; data.weather.lon = 9.19;
  assert.deepEqual(core.activeWidgets(data), ['clock','countdown','weather','quote'], '顺序按 order，不按 KINDS');
});
