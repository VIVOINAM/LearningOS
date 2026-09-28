"use strict";
/*
 * 知识地图读写库里的文件：概念图谱（agent 写，这里只读）和掌握度记录（这里只追加）。
 * 不再往 data.json 里放知识数据——Obsidian 运行时会整份覆盖它，agent 从外面写进去会被冲掉。
 */
const G=require('./knowledge-graph');
const Mastery=require('./mastery');
const {ensureFile}=require('../shared/vault-utils');

/** 读全部图谱。结构不合格的整份不用，那门课回退到标题解析，并把原因报出来。解析结果按修改时间缓存。 */
async function loadGraphs(plugin,files){
  const cache=plugin.graphCache||=new Map(),graphs=new Map(),problems=[];
  const live=files.filter(f=>G.isGraphPath(f.path));
  for(const path of cache.keys())if(!live.some(f=>f.path===path))cache.delete(path);
  for(const file of live){
    const version=`${file.stat?.mtime}:${file.stat?.size}`;
    let hit=cache.get(file.path);
    if(!hit||hit.version!==version||!file.stat?.mtime){
      try{const graph=JSON.parse(await plugin.app.vault.cachedRead(file)),errors=G.structureErrors(graph);hit={version,graph,errors};}
      catch(e){hit={version,graph:null,errors:[`JSON 解析失败：${e.message}`]};}
      cache.set(file.path,hit);
    }
    if(hit.errors.length)problems.push({file:file.basename,errors:hit.errors});
    else graphs.set(String(hit.graph.course),hit.graph);
  }
  return {graphs,problems};
}

const serialize=doc=>`{"version":${doc.version||1},"records":[\n${doc.records.map(r=>JSON.stringify(r)).join(',\n')}\n]}\n`;
async function readMastery(plugin){
  const file=plugin.app.vault.getAbstractFileByPath(Mastery.MASTERY_PATH);
  return Mastery.parseMastery(file?await plugin.app.vault.read(file):null);
}
/** 追加记录。process 是 Obsidian 的原子读改写；读到的内容坏了就抛错，不覆盖。 */
async function appendMastery(plugin,records){
  if(!records.length)return;
  const vault=plugin.app.vault,file=await ensureFile(plugin.app,Mastery.MASTERY_PATH,serialize({version:1,records:[]}));
  await vault.process(file,current=>serialize(Mastery.appendRecords(Mastery.parseMastery(current),records)));
}
const setLevel=(plugin,concept,course,level)=>appendMastery(plugin,[Mastery.masteryRecord({concept,course,level,source:'manual'})]);

/**
 * 7.4 的自评存在 data.json 的 knowledgeMap.statuses。第一次读到某门课的图谱时，把能对上的写进掌握度记录。
 * 处理过的旧键记在 knowledgeMap.migrated，旧数据本身保留一个版本，下个版本再清。
 */
async function migrateLegacy(plugin,graphs){
  const state=plugin.data.knowledgeMap||{},done=new Set(state.migrated||[]);
  const pending=Object.fromEntries(Object.entries(state.statuses||{}).filter(([key])=>!done.has(key)&&[...graphs.keys()].some(c=>key.startsWith(c+':'))));
  if(!Object.keys(pending).length)return {migrated:0,unmatched:state.unmatched||[]};
  const {records,unmatched}=Mastery.legacyMigration([...graphs.values()],pending);
  await appendMastery(plugin,records);
  plugin.data.knowledgeMap={...state,migrated:[...done,...Object.keys(pending)],unmatched:[...new Set([...(state.unmatched||[]),...unmatched])]};
  await plugin.save();
  return {migrated:records.length,unmatched:plugin.data.knowledgeMap.unmatched};
}
module.exports={loadGraphs,readMastery,appendMastery,setLevel,migrateLegacy,serialize};
