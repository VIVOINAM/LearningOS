"use strict";
const {outcomeMarkdown,withStatus}=require('./learning-hub-model');
const {ensureFile}=require('../shared/vault-utils');
const safe=value=>String(value).replace(/[\\/:*?"<>|#^[\]\r\n]/g,' ').replace(/\s+/g,' ').trim().slice(0,90);
async function mutateMap(plugin,change) {
  return plugin.run(async()=>{
    const before=plugin.data.knowledgeMap;
    plugin.data.knowledgeMap=change(before||{});
    try{await plugin.save();}catch(error){plugin.data.knowledgeMap=before;throw error;}
  });
}
const setStatus=(p,key,status)=>mutateMap(p,state=>withStatus(state,key,status));
async function saveOutcome(plugin,value) {
  const markdown=outcomeMarkdown(value),course=plugin.courseCatalog().find(c=>String(c.id)===String(value.course));
  if(!course)throw Error('课程不存在');
  return plugin.run(async()=>{
    const base=`03 知识库/学习成果/${safe(course.id+' '+course.title)}/${safe(value.title)||'学习成果'}`;
    let path=base+'.md',n=2;while(plugin.app.vault.getAbstractFileByPath(path))path=`${base} ${n++}.md`;
    return ensureFile(plugin.app,path,markdown);
  });
}
module.exports={setStatus,saveOutcome};
