"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {audit,markdown}=require("../daily-audit");

const DAY="2026-09-14";
const START=new Date(`${DAY}T00:00:00`).getTime();

test("每日审计只为当日完成任务统计已完成番茄钟和百分比",()=>{
  const tasks=[
    {id:"today",text:"今天的任务",path:"00 工作台/今日任务.md",done:true,doneDate:DAY,estimated_pomodoros:4},
    {id:"old",text:"昨天的任务",path:"00 工作台/今日任务.md",done:true,doneDate:"2026-09-13",estimated_pomodoros:2},
  ];
  const sessions=[
    {id:"today-round",phase:"focus",completed:true,taskId:"today",task:"今天的任务",seconds:1500,endedAt:START+3600000},
    {id:"today-partial",phase:"focus",completed:false,taskId:"today",task:"今天的任务",seconds:600,endedAt:START+7200000},
    {id:"old-round",phase:"focus",completed:true,taskId:"old",task:"昨天的任务",seconds:1500,endedAt:START-3600000},
  ];
  const report=audit(sessions,tasks,DAY);
  assert.equal(report.done.length,1);
  assert.equal(report.done[0].id,"today");
  assert.equal(report.done[0].completedPomodoros,1);
  assert.equal(report.done[0].completionPercent,25);
  assert.match(markdown(report,DAY),/今天的任务 · 完成 1\/4 个番茄钟 · 25%/);
  assert.doesNotMatch(markdown(report,DAY),/昨天的任务/);
});
