"use strict";
/*
 * 周五自测：题库校验、判分、换算掌握度。纯函数，插件和 tools/check-quiz.cjs 共用。
 * 题库由 agent 写（03 知识库/周五自测/<ISO 周>.json），规则见 docs/知识图谱与出题规范.md。
 */
const QUIZ_DIR='03 知识库/周五自测';
const TYPES=['single','multiple','truefalse','numeric'];
const LEVELS_Q=['concept','application'];
const PER_COURSE=10;
const isQuizPath=path=>new RegExp(`^${QUIZ_DIR}/\\d{4}-W\\d{2}\\.json$`).test(path);
const answersPath=week=>`${QUIZ_DIR}/${week} 作答.json`;
const text=v=>typeof v==='string'&&v.trim()!=='';
const list=v=>Array.isArray(v)?v:[];

/** 公式定界符成对：去掉 $$ 之后，剩下的单个 $ 也要成对。代码块里的不算。 */
function delimitersBalanced(s){
  const body=String(s).replace(/```[\s\S]*?```/g,'').replace(/`[^`]*`/g,'').replace(/\\\$/g,'');
  const blocks=(body.match(/\$\$/g)||[]).length;if(blocks%2)return false;
  return (body.replace(/\$\$/g,'').match(/\$/g)||[]).length%2===0;
}

/**
 * 题库检查。graphs: Map(课程代码 → 图谱)。deep 可选：{exists(path,heading)→bool, image(name)→bool}。
 * 返回错误列表，每条指出哪门课哪一题。
 */
function quizErrors(quiz,graphs,deep=null){
  const errors=[],say=(where,msg)=>errors.push(`${where}：${msg}`);
  if(!quiz||typeof quiz!=='object')return ['不是 JSON 对象'];
  if(!/^\d{4}-W\d{2}$/.test(quiz.week||''))say('week','应为 2026-W39 这种格式');
  if(!list(quiz.courses).length)say('courses','没有课程');
  const seenCourses=new Set();
  for(const block of list(quiz.courses)){
    const course=String(block?.course||''),graph=graphs.get(course),at=q=>`${course}${q?' '+q:''}`;
    if(seenCourses.has(course))say(at(),'同一门课出现了两次');seenCourses.add(course);
    if(!graph){say(at(),'这门课没有概念图谱');continue;}
    const live=new Set(list(graph.concepts).filter(c=>!c.retired).map(c=>c.id)),qs=list(block.questions);
    if(qs.length!==PER_COURSE)say(at(),`应为 ${PER_COURSE} 题，现在 ${qs.length} 题`);
    const ids=new Set(),tested=new Map();
    for(const q of qs){
      const where=at(q?.id||'?');
      if(!/^q\d{2}$/.test(q?.id||''))say(where,'题号应为 q01 这种格式');else if(ids.has(q.id))say(where,'题号重复');ids.add(q?.id);
      if(!TYPES.includes(q?.type))say(where,`题型只能是 ${TYPES.join(' / ')}`);
      if(!LEVELS_Q.includes(q?.level))say(where,'level 只能是 concept 或 application');
      if(!text(q?.stem))say(where,'缺少题干');
      if(!text(q?.explanation))say(where,'缺少解析');
      if(!list(q?.concepts).length)say(where,'没有标考察的概念');
      for(const c of list(q?.concepts)){if(!live.has(c))say(where,`概念 ${c} 不在图谱里或已退役`);else tested.set(c,(tested.get(c)||0)+1);}
      const opts=list(q?.options);
      if(q?.type==='single'||q?.type==='multiple'){
        if(opts.length<3||opts.length>6)say(where,'选项应为 3 到 6 个');
        if(opts.some(o=>!text(o)))say(where,'有空选项');
        if(new Set(opts.map(o=>String(o).trim())).size!==opts.length)say(where,'选项有重复');
        const ans=list(q.answer);
        if(!ans.length||ans.some(i=>!Number.isInteger(i)||i<0||i>=opts.length))say(where,'答案下标超出选项范围（从 0 数起）');
        if(new Set(ans).size!==ans.length)say(where,'答案下标重复');
        if(q.type==='single'&&ans.length!==1)say(where,'单选题只能有一个答案');
        if(q.type==='multiple'&&ans.length<2)say(where,'多选题至少两个答案；只有一个就出成单选');
      }else if(q?.type==='truefalse'){
        if(typeof q.answer!=='boolean')say(where,'判断题的答案是 true 或 false');
        if(opts.length)say(where,'判断题不写选项');
      }else if(q?.type==='numeric'){
        const a=q.answer;
        if(!a||!Number.isFinite(a.value))say(where,'数值题的答案要写 {"value": …}');
        else if(!(a.tolerance>0)&&!(a.abs>0))say(where,'数值题要给 tolerance（相对）或 abs（绝对）误差');
        if(a?.value===0&&!(a.abs>0))say(where,'答案为 0 时只能用 abs 绝对误差');
        if(!text(q.unit))say(where,'数值题要写单位（无量纲写 "—"）');
      }
      for(const [field,value] of [['题干',q?.stem],['解析',q?.explanation],...opts.map((o,i)=>[`选项 ${i+1}`,o])])if(text(value)&&!delimitersBalanced(value))say(where,`${field}的公式定界符不成对`);
      if(!text(q?.source?.path)||!text(q?.source?.heading))say(where,'缺少原文出处');
      else if(deep&&!deep.exists(q.source.path,q.source.heading))say(where,`出处不存在：${q.source.path.split('/').pop()}#${q.source.heading}`);
      if(deep)for(const m of String(q?.stem||'').matchAll(/!\[\[([^\]|]+)/g))if(!deep.image(m[1]))say(where,`配图找不到：${m[1]}`);
    }
    for(const [c,n] of tested)if(n<2)say(at(),`概念 ${c} 只考了 ${n} 题，每个被考的概念至少 2 题`);
  }
  return errors;
}

/** 选项乱序：按题目 ID 和周次稳定地打乱，同一题每次打开顺序一样，续做时不会变。 */
function shuffledOrder(n,seed){
  let h=2166136261;for(const ch of String(seed)){h^=ch.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}
  const order=[...Array(n).keys()];
  for(let i=n-1;i>0;i--){h=Math.imul(h^(h>>>15),2246822507)>>>0;const j=h%(i+1);[order[i],order[j]]=[order[j],order[i]];}
  return order;
}

/**
 * 判一题。response：{choice:[原始下标…]} / {value:数} / {bool:true|false} / {unsure:true}。
 * 「不确定」按没掌握算，不去赌那 25%。
 */
function isCorrect(q,response){
  if(!response||response.unsure)return false;
  if(q.type==='numeric'){
    const v=Number(response.value),a=q.answer;if(!Number.isFinite(v))return false;
    const d=Math.abs(v-a.value);return (a.abs>0&&d<=a.abs)||(a.tolerance>0&&d<=Math.abs(a.value)*a.tolerance+1e-12);
  }
  if(q.type==='truefalse')return response.bool===q.answer;
  const got=[...new Set(list(response.choice))].sort(),want=[...q.answer].sort();
  return got.length===want.length&&got.every((x,i)=>x===want[i]);
}

/**
 * 一门课一周的作答换算成各概念的档位。只看首次作答、没被标成「这题有问题」的题。
 * 概念题有错或选了不确定 → 需巩固；概念题全对、应用题有错或没考应用题 → 已理解；都对 → 能应用。
 * 只考了应用题的概念：全对 → 能应用，有错 → 需巩固。本周没考到的概念不出现在结果里（维持原档位）。
 */
function conceptLevels(questions,first){
  const per=new Map();
  for(const q of questions){
    const r=first[q.id];if(!r||r.flagged)continue;
    const ok=isCorrect(q,r);
    for(const c of q.concepts){if(!per.has(c))per.set(c,{concept:[],application:[]});per.get(c)[q.level].push([q.id,ok]);}
  }
  const out=new Map();
  for(const [c,{concept,application}] of per){
    let level;
    if(concept.length)level=concept.some(([,ok])=>!ok)?'review':application.length&&application.every(([,ok])=>ok)?'applied':'understood';
    else level=application.every(([,ok])=>ok)?'applied':'review';
    out.set(c,{level,questions:[...concept,...application].sort((a,b)=>a[0].localeCompare(b[0]))});
  }
  return out;
}

/** 作答文件：{week, attempts:[{course, question, response, at, seconds, first, flagged}]}。首次作答 = 每题第一条。 */
function firstAttempts(doc,course){
  const out={};
  for(const a of list(doc?.attempts))if(a.course===course&&a.first&&!out[a.question])out[a.question]={...a.response,flagged:!!a.flagged};
  for(const a of list(doc?.attempts))if(a.course===course&&a.flagged&&out[a.question])out[a.question].flagged=true;
  return out;
}
module.exports={QUIZ_DIR,TYPES,PER_COURSE,isQuizPath,answersPath,delimitersBalanced,quizErrors,shuffledOrder,isCorrect,conceptLevels,firstAttempts};
