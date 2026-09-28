"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../reading-pager");

test("外部跳转期间重绘不能拉回旧锚点", () => {
  const pager=Object.create(P.Pager.prototype);
  Object.assign(pager,{on:true,cur:{},jumping:true,geometry:()=>{throw Error('Should not measure old anchor');}});
  pager.paint();
  let released=false;
  Object.assign(pager,{jumping:false,own:100,geometry:()=>({scroller:{scrollTop:900}}),releaseForJump:()=>{released=true;}});
  pager.paint();assert.equal(released,true);
});

test("目录跳转按目标标题的真实上沿对齐，不能沿用半行位置", () => {
  const pager=Object.create(P.Pager.prototype), target={getBoundingClientRect:()=>({top:75})};
  const g={sizerTop:-1000,sizer:{contains:n=>n===target},scroller:{scrollTop:1200}};
  let placed;
  Object.assign(pager,{on:true,busy:false,jumpTarget:()=>target,geometry:()=>g,anchor:(_,y)=>({y}),place:(_,p)=>{placed=p;},paint:()=>{}});
  pager.resync();assert.equal(placed.y,1075);assert.equal(pager.jumpTarget,null);assert.equal(pager.jumping,false);
});

test("篇末空标题不把短模板额外拆页", () => {
  const box=(tagName,top,bottom)=>({tagName,className:'',getBoundingClientRect:()=>({top,bottom,height:bottom-top})});
  const sizer={children:[box('P',100,160),box('H2',190,220),box('H2',260,290)]};
  assert.equal(P.keepHeading(sizer,800,80),800);
});

test("末尾尚未渲染的 section 不能当作文章已经结束", () => {
  const shown = {el:{getBoundingClientRect:()=>({bottom:100})},shown:true,height:100,computed:true};
  const pending = {el:{},shown:false,height:100,computed:true};
  const pager = Object.create(P.Pager.prototype);
  pager.options={renderer:()=>({sections:[shown,pending]})};pager.end=200;
  assert.equal(pager.atEnd({sizer:{contains:el=>el===shown.el},sizerTop:0}),false);
});

test("翻页前先重算边界，禁用时不重算", async () => {
  const pager=Object.create(P.Pager.prototype), calls=[];
  Object.assign(pager,{on:true,busy:false,paint:()=>calls.push('paint'),geometry:()=>({sizer:{}}),
    next:()=>{calls.push('next');return null;},bump:()=>{}});
  await pager.flip(1);assert.deepEqual(calls,['paint','next']);
  pager.on=false;await pager.flip(1);assert.equal(calls.length,2);
});

test("短段落整块换页，超长表格行允许递归到内部内容", () => {
  const rect=(top,bottom)=>({top,bottom,height:bottom-top});
  const paragraph={tagName:'P',matches:()=>true,getBoundingClientRect:()=>rect(650,750)};
  const win={getComputedStyle:n=>({display:n.tagName==='TR'?'table-row':'block'})};
  assert.deepEqual(P.unitAt({children:[paragraph]},700,win,600),{top:650,bottom:750});
  const row={tagName:'TR',matches:()=>false,getBoundingClientRect:()=>rect(50,1000),children:[paragraph]};
  assert.deepEqual(P.unitAt({children:[row]},700,win,600),{top:650,bottom:750});
});

test("方向键、翻页键、空格各翻一页；带修饰键的不管", () => {
  assert.equal(P.keyDirection({ key: "ArrowRight" }), 1);
  assert.equal(P.keyDirection({ key: "ArrowDown" }), 1);
  assert.equal(P.keyDirection({ key: "PageDown" }), 1);
  assert.equal(P.keyDirection({ key: " " }), 1);
  assert.equal(P.keyDirection({ key: " ", shiftKey: true }), -1);
  assert.equal(P.keyDirection({ key: "ArrowLeft" }), -1);
  assert.equal(P.keyDirection({ key: "PageUp" }), -1);
  assert.equal(P.keyDirection({ key: "ArrowRight", ctrlKey: true }), 0);
  assert.equal(P.keyDirection({ key: "ArrowLeft", altKey: true }), 0);
  assert.equal(P.keyDirection({ key: "a" }), 0);
});

test("一次滚轮手势只翻一页：触控板惯性的一串事件不会连翻", () => {
  const s = {};
  let flips = 0;
  for (let t = 0; t < 1000; t += 16) flips += Math.abs(P.wheelStep(s, { deltaY: 12, deltaMode: 0 }, t));
  assert.equal(flips, 1);
  // 停一下再滚，是新的一次。
  assert.equal(P.wheelStep(s, { deltaY: 100, deltaMode: 0 }, 1500), 1);
});

test("滚轮：小于门槛不翻，横向和竖向都算，按行计的滚轮换算成像素", () => {
  const s = {};
  assert.equal(P.wheelStep(s, { deltaY: 20 }, 0), 0);
  assert.equal(P.wheelStep(s, { deltaY: 20 }, 10), 0);
  assert.equal(P.wheelStep(s, { deltaY: 20 }, 20), 1);
  assert.equal(P.wheelStep({}, { deltaX: -80, deltaY: 5 }, 0), -1);
  assert.equal(P.wheelStep({}, { deltaY: 3, deltaMode: 1 }, 0), 1);
  // 往下一点又往回：不抵消成零，往回的那一下从头累计。
  const back = {};
  assert.equal(P.wheelStep(back, { deltaY: 30 }, 0), 0);
  assert.equal(P.wheelStep(back, { deltaY: -30 }, 10), 0);
  assert.equal(P.wheelStep(back, { deltaY: -30 }, 20), -1);
});

test("横扫：往左、往上是下一页；太短太慢的是点和选字", () => {
  assert.equal(P.swipeDirection(-120, 10, 200), 1);
  assert.equal(P.swipeDirection(120, -10, 200), -1);
  assert.equal(P.swipeDirection(5, -150, 200), 1);
  assert.equal(P.swipeDirection(5, 150, 200), -1);
  assert.equal(P.swipeDirection(20, 10, 100), 0);
  assert.equal(P.swipeDirection(-200, 0, 1500), 0);
});

test("页底：断在跨线那一行的上沿；几乎没往前走（比一屏还高的图）就硬切", () => {
  assert.equal(P.pageCut({ top: 780, bottom: 808 }, 100, 800), 780);
  assert.equal(P.pageCut(null, 100, 800), 800);
  assert.equal(P.pageCut({ top: 120, bottom: 1400 }, 100, 800), 800);
});

test("跳转后的页首：跨在顶上的一行露出一半以上就留着，否则从它下沿开始", () => {
  assert.equal(P.pageStart(null, 100, 700), 100);
  assert.equal(P.pageStart({ top: 90, bottom: 118 }, 100, 700), 90);
  assert.equal(P.pageStart({ top: 80, bottom: 104 }, 100, 700), 104);
  // 一张很高的图只露着尾巴：尾巴不长就从图下开始，很长就原地开始，免得整页空着。
  assert.equal(P.pageStart({ top: -900, bottom: 150 }, 100, 700), 150);
  assert.equal(P.pageStart({ top: -900, bottom: 700 }, 100, 700), 100);
});

test("连着的几个标题一起挪到下一页（实机：「2 · 例题逐题解析」+「2.1 吊钩」+ 一张图）", () => {
  const box = (className, top, bottom, tagName = "DIV") => ({ className, tagName, firstElementChild: null, getBoundingClientRect: () => ({ top, bottom, height: bottom - top }) });
  const sizer = { children: [box("el-p", 545, 574), box("el-hr", 606, 608), box("el-h3", 640, 664), box("el-h4", 680, 703), box("el-p", 719, 998)] };
  // 页底线 822 落在图里，先断在图上沿 719；2.1 挪过去，2 也跟着挪过去。
  assert.equal(P.keepHeading(sizer, 719, 98), 640);
  // 标题下面已经跟着好几行正文的，不挪。
  assert.equal(P.keepHeading(sizer, 900, 98), 900);
  // 挪完这一页就空了的（标题就在页首），不挪。
  assert.equal(P.keepHeading(sizer, 719, 630), 719);
});
