"use strict";
/*
 * 掌握度记录：03 知识库/知识地图/掌握度.json，只由插件写，只追加不覆盖。
 * 每条记一个概念在某个时刻的档位和来源（自测 / 手动 / 迁移）；地图显示时间最新的一条，
 * 手动修改和自测结果冲突时也是按时间取最新，两条都留着。
 */
const {day}=require('../shared/date');
const {LEVELS}=require('./learning-hub-model');
const MASTERY_PATH='03 知识库/知识地图/掌握度.json';
const SOURCES={quiz:'自测',manual:'手动',migration:'迁移'};

/** 文件不存在或是空的算没有记录；内容坏了就报错，绝不拿空记录去覆盖它。 */
function parseMastery(text){
  if(text==null||!String(text).trim())return {version:1,records:[]};
  const doc=JSON.parse(text);
  if(!doc||!Array.isArray(doc.records))throw Error('掌握度.json 格式不对：缺少 records 数组');
  return doc;
}
function masteryRecord({concept,course,level,source,at=new Date().toISOString(),basis=null}){
  if(!/^c-/.test(concept||''))throw Error('未知概念');
  if(!Object.hasOwn(LEVELS,level))throw Error('未知掌握状态');
  if(!Object.hasOwn(SOURCES,source))throw Error('未知掌握度来源');
  return basis?{concept,course:String(course||''),level,source,at,basis}:{concept,course:String(course||''),level,source,at};
}
const appendRecords=(doc,records)=>({...doc,version:doc.version||1,records:[...doc.records,...records]});
/** 每个概念最新的一条。时间相同按写入顺序，后写的算。 */
function latestByConcept(records){
  const out=new Map();
  for(const r of records||[]){const prev=out.get(r.concept);if(!prev||String(r.at)>=String(prev.at))out.set(r.concept,r);}
  return out;
}
const shortDay=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'':`${d.getMonth()+1}/${d.getDate()}`;};
/** 概念卡上那一行「依据」。 */
function basisLabel(record){
  if(!record)return '还没有自测记录';
  if(record.source==='manual')return `${shortDay(record.at)} 手动`;
  if(record.source==='migration')return '迁移自旧版自评';
  const qs=(record.basis?.questions||[]).map(([id,ok])=>`第${Number(String(id).replace(/\D/g,''))||id}题 ${ok?'✓':'✗'}`);
  return `${shortDay(record.at)} 自测${qs.length?' '+qs.join(' '):''}`;
}

/** 本周一到周日（本地日期）。「本周新学」和「新」标记都按这个算。 */
function weekRange(time=Date.now()){
  const d=new Date(time);d.setHours(12,0,0,0);const back=(d.getDay()+6)%7;
  const start=new Date(d);start.setDate(d.getDate()-back);const end=new Date(start);end.setDate(start.getDate()+6);
  return {start:day(start),end:day(end)};
}
const inWeek=(key,time=Date.now())=>{const {start,end}=weekRange(time);return !!key&&key>=start&&key<=end;};
/** ISO 周：2026-W39。周五自测的题库按它命名。 */
function isoWeek(time=Date.now()){
  const d=new Date(time);d.setHours(12,0,0,0);d.setDate(d.getDate()+3-(d.getDay()+6)%7);
  const first=new Date(d.getFullYear(),0,4,12);
  const week=1+Math.round(((d-first)/864e5-3+(first.getDay()+6)%7)/7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}

/**
 * 旧版（7.4）存在 data.json 里的自评，按图谱的 legacyKeys 换成新概念的记录。
 * 一个概念对上几个旧键时取最靠后的档位（applied > understood > review）；对不上的旧键原样报出来，不静默丢弃。
 */
function legacyMigration(graphs,statuses={},at=new Date().toISOString()){
  const owner=new Map();
  for(const g of graphs)for(const c of g.concepts||[])if(!c.retired)for(const key of c.legacyKeys||[])owner.set(key,{c,course:g.course});
  const order=Object.keys(LEVELS),best=new Map(),unmatched=[];
  for(const [key,level] of Object.entries(statuses||{})){
    if(!Object.hasOwn(LEVELS,level)||level==='unknown')continue;
    const hit=owner.get(key);
    if(!hit){if(graphs.some(g=>key.startsWith(g.course+':')))unmatched.push(key);continue;}
    const prev=best.get(hit.c.id);
    if(!prev||order.indexOf(level)>order.indexOf(prev.level))best.set(hit.c.id,{concept:hit.c.id,course:hit.course,level});
  }
  return {records:[...best.values()].map(r=>masteryRecord({...r,source:'migration',at})),unmatched};
}
module.exports={MASTERY_PATH,SOURCES,parseMastery,masteryRecord,appendRecords,latestByConcept,basisLabel,weekRange,inWeek,isoWeek,legacyMigration};
