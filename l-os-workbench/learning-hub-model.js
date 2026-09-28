"use strict";
const {scan}=require('./reading-rail-model');
const {isSummaryNote,summaryEntry}=require('./summary-notes');
const LEVELS={unknown:'待自评',review:'需巩固',understood:'已理解',applied:'能应用'};
const OUTCOME_TYPES={recall:'记忆笔记',concept:'概念总结',formula:'公式',method:'解题方法'};
/*
 * 标题怎样才算一个知识点。按库里真实的课堂笔记定的：九篇笔记原样解析出来，静力学一门就有 83 个「知识点」，
 * 其中一大半是学习指引（一页速查、自测、官方来源与对照阅读、课后作业、运行方法与验证记录……）
 * 和例题（例 1、官方例题二、巩固题 A……）。地图要的是概念。
 *
 * - 指引节：连同下面的小节整块跳过。
 * - 例题节：不成节点，挂到它所在的那个概念下面，详情里列成「例题」。
 *   标题只是「例题逐题解析」「等效电阻：六道例题」这种容器的，它自己不成节点，下面的例题往上挂。
 * - 标题清理：去掉编号、日期（9/14）、章次（第 1 章）、「习题课 E01：」「讲义 p.1–32：」这类前缀，
 *   和括号里的页码（p.7、PDF 第 4–5 页、幻灯片 12–13）；括号里的术语原名留着。
 *   清理后的标题才拿来合并同名概念——带着页码，同一个概念在两篇笔记里永远对不上。
 */
// 笔记骨架那几个固定大标题：自己不成节点，下面的小节往上提一级。
const WRAPPER=/^(?:课堂记录|课后总结(?:与自查)?|今日要点|今日总结|学习目标|本节小结)$/;
const GUIDE=/^(?:来源(?:与说明)?|资料来源|目录|这(?:几|三)次课分别讲了什么)$|速查|自测|自检|复习问题|术语对照|对照阅读|来源与|原始资料|阅读地图|一条主线|习题课主线|摘要与记号|代码入口|运行方法|验证记录|检查顺序|做题顺序|解题顺序|做题决策|课后作业|Compiti|不看答案|易错|易混|失分|在练什么|对应的练习|三把工具/;
const EXAMPLE=/^(?:例\s*\d|例[一二三四五六七八九十]|例题[：:]|官方例题|补充例题|课件例题|巩固题|练习\s*\d|习题\s*\d|Esercizio)/i;
// 例题的「容器」：「例题逐题解析」「配套编程习题」这种，下面一节一道题。
const EXAMPLE_GROUP=/例题|习题|逐题/;
// 末尾括号里可以丢掉的段：页码、讲义出处、它包含哪几道例题。
const PAGE_PART=/^(?:p\.|PDF|第\s*[\d、，,–-]+\s*页|原讲义|幻灯片|讲义\s*p|例\s*\d)/i;
const shortDate=key=>{const m=/^\d{4}-(\d{2})-(\d{2})$/.exec(key||'');return m?`${+m[1]}/${+m[2]}`:'';};
function titleOf(heading){
  let t=String(heading).replace(/^\d+(?:\.\d+)*[.、·．\s]+/,'').trim();
  t=t.replace(/^\d{1,2}\/\d{1,2}[\s　]+/,'').replace(/^第\s*[一二三四五六七八九十\d]+\s*[章节讲][\s　]*/,'')
    .replace(/^习题课\s*E?\d*\s*[：:]\s*/,'').replace(/^讲义\s*p\.[\d–-]+\s*[：:]\s*/,'');
  // 末尾括号：拆成几段，只丢页码那几段；全是页码就整个括号去掉。
  t=t.replace(/[（(]([^（）()]*)[）)]\s*$/,(whole,inner)=>{const kept=inner.split(/[，,；;]/).map(s=>s.trim()).filter(s=>s&&!PAGE_PART.test(s));return kept.length?`（${kept.join('，')}）`:'';});
  return t.trim();
}
const nodeKey=(course,title)=>`${course}:${encodeURIComponent(title.trim().toLocaleLowerCase())}`;
function topicsFromNote(file,text,fm={},courses=[]) {
  if(!isSummaryNote(file))return [];
  const entry=summaryEntry(file,fm,text,courses),lines=String(text).replace(/\r\n?/g,'\n').split('\n');
  const headings=scan(text).headings,stack=[],topics=[];let skipBelow=0,orphans='';
  const spanEnd=(i,level)=>{for(let j=i+1;j<headings.length;j++)if(headings[j].level<=level)return headings[j].line;return lines.length;};
  for(let i=0;i<headings.length;i++){
    const h=headings[i],title=titleOf(h.heading);
    if(skipBelow&&h.level>skipBelow)continue;
    skipBelow=0;
    while(stack.length&&stack.at(-1).level>=h.level)stack.pop();
    if(h.level===1||WRAPPER.test(title))continue;
    if(GUIDE.test(title)){skipBelow=h.level;continue;}
    const source={path:file.path,heading:h.heading,line:h.line,date:entry.date};
    const owner=[...stack].reverse().find(s=>s.key);
    const collecting=[...stack].reverse().find(s=>s.examples);
    // lead 是这一节自己的正文（到下一个标题为止），详情里当原文摘录显示；body 连同小节，供需要整节的地方用。
    let next=lines.length;for(let j=i+1;j<headings.length;j++){next=headings[j].line;break;}
    const node=(name,parent)=>{const key=nodeKey(entry.code,name);topics.push({key,title:name,course:entry.code,courseTitle:entry.course,parent:parent===key?'':parent,
      source:{...source,lead:lines.slice(h.line+1,next).join('\n').trim(),body:lines.slice(h.line+1,spanEnd(i,h.level)).join('\n').trim()}});return key;};
    if(collecting||EXAMPLE.test(title)){
      // 例题挂到最近的概念上；它下面的小节（解法一、解法二）也算这道题，不再往下拆。
      // 上面没有概念的（「## 7. 官方例题一：…」和概念平级），归到这篇笔记的「例题（9/23）」节点。
      const target=collecting?.examples||owner?.key||(orphans||=node(`例题（${shortDate(entry.date)}）`,''));
      topics.push({example:true,owner:target,title,source});
      skipBelow=h.level;continue;
    }
    const colon=title.search(/[：:]/),head=(colon<0?title:title.slice(0,colon)).trim();
    if(EXAMPLE_GROUP.test(head)){
      // 纯容器：有上级概念就把题挂过去；没有（整篇习题课就是一串题）就自己成一个带日期的「例题」节点。
      if(owner){stack.push({key:'',level:h.level,examples:owner.key});continue;}
      const key=node(`${head}（${shortDate(entry.date)}）`,'');
      stack.push({key,level:h.level,examples:key});continue;
    }
    // 「等效电阻：六道例题」：概念是冒号前那一半，下面的题都挂在它上面。
    const collects=colon>=0&&EXAMPLE_GROUP.test(title.slice(colon+1));
    const key=node(collects?head:title,owner?.key||'');
    stack.push({key,level:h.level,examples:collects?key:''});
  }
  return topics;
}
function buildMap(topics,state={}) {
  const byKey=new Map();
  for(const topic of topics){
    if(topic.example)continue;
    let node=byKey.get(topic.key);
    if(!node){node={...topic,sources:[],parents:[],examples:[]};delete node.source;byKey.set(topic.key,node);}
    if(!node.sources.some(s=>s.path===topic.source.path&&s.line===topic.source.line))node.sources.push(topic.source);
    if(topic.parent&&!node.parents.includes(topic.parent))node.parents.push(topic.parent);
  }
  for(const e of topics.filter(t=>t.example)){
    const node=byKey.get(e.owner);
    if(node&&!node.examples.some(x=>x.path===e.source.path&&x.line===e.source.line))node.examples.push({title:e.title,...e.source});
  }
  return [...byKey.values()].map(node=>{
    const sources=node.sources.sort((a,b)=>b.date.localeCompare(a.date)||a.path.localeCompare(b.path));
    // 第一次出现在哪天：地图按这个日期分组。
    const first=sources.reduce((a,b)=>!a||b.date&&b.date<a.date?b:a,null);
    return {...node,sources,firstDate:first?.date||'',status:Object.hasOwn(LEVELS,state.statuses?.[node.key])?state.statuses[node.key]:'unknown'};
  });
}
function outcomeEntry(file,fm={}) {
  if(file.extension!=='md'||fm.type!=='learning-outcome')return null;
  return {file,path:file.path,title:fm.title||file.basename,course:String(fm.course||''),kind:Object.hasOwn(OUTCOME_TYPES,fm.kind)?fm.kind:'concept',
    cue:String(fm.cue||fm.title||file.basename),concept:String(fm.concept||''),concepts:Array.isArray(fm.concepts)?fm.concepts.map(String):(fm.concept?[String(fm.concept)]:[]),source:String(fm.source||''),updatedAt:file.stat?.mtime||0};
}
function outcomeMarkdown({title,course,kind='recall',cue='',concept='',concepts=[],source='',body}) {
  if(!String(title||'').trim())throw Error('请填写成果标题');
  if(!String(body||'').trim())throw Error('请写下总结、公式或解题方法');
  if(!course)throw Error('请选择所属课程');
  if(!Object.hasOwn(OUTCOME_TYPES,kind))throw Error('请选择成果类型');
  const field=(key,value)=>`${key}: ${JSON.stringify(String(value))}`;
  return ['---','type: learning-outcome',field('title',title.trim()),field('course',course),field('kind',kind),field('cue',cue.trim()||title.trim()),field('concept',concept),'concepts: '+JSON.stringify([...new Set([concept,...concepts].filter(Boolean))]),field('source',source),'---',`# ${title.trim()}`,'',body.trim(),'',source?`来源：[[${source}]]`:'',''].join('\n');
}
function withStatus(state,key,status) {
  if(!Object.hasOwn(LEVELS,status))throw Error('未知掌握状态');
  return {...state,statuses:{...state.statuses,[key]:status}};
}
// 按课程取最新证据；同名概念不能跨课程串档。自评不充当自测验证。
function courseProgress(graph,records=[]){
  const latest=new Map();
  for(const r of records)if(String(r.course)===String(graph.course)){
    const prev=latest.get(r.concept);if(!prev||String(r.at)>=String(prev.at))latest.set(r.concept,r);
  }
  const result={applied:[],understood:[],review:[],self:[],pending:0};
  for(const c of graph.concepts||[]){
    if(c.retired)continue;
    const r=latest.get(c.id),entry={...c,record:r};
    const tested=r?.source==='quiz'&&(r.basis?.questions||[]).length>0;
    if(r?.level==='review')result.review.push(entry);
    else if(tested&&['applied','understood'].includes(r.level))result[r.level].push(entry);
    else if(['applied','understood'].includes(r?.level))result.self.push(entry);
    else result.pending++;
  }
  return result;
}
module.exports={LEVELS,OUTCOME_TYPES,nodeKey,titleOf,topicsFromNote,buildMap,outcomeEntry,outcomeMarkdown,withStatus,courseProgress};
