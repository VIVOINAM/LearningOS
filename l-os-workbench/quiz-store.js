"use strict";
/*
 * 周五自测的读写：题库只读（agent 写），作答文件和掌握度记录由这里追加。
 * 作答文件 03 知识库/周五自测/<周> 作答.json：
 *   attempts 每答一题追加一条，中途关掉下次接着做；
 *   graded[course] 记下第一次判分前各概念的档位，结果页据此显示「待自评 → 已理解」。
 */
const Q=require('./quiz-model');
const Mastery=require('./mastery');
const KStore=require('./knowledge-store');
const {ensureFile}=require('../shared/vault-utils');

/** 库里有哪些周的题库，新的在前。 */
const quizWeeks=files=>files.filter(f=>Q.isQuizPath(f.path)).map(f=>f.basename).sort().reverse();

async function loadQuiz(plugin,week,graphs){
  const path=`${Q.QUIZ_DIR}/${week}.json`,file=plugin.app.vault.getAbstractFileByPath(path);
  if(!file)return null;
  let quiz;try{quiz=JSON.parse(await plugin.app.vault.read(file));}catch(e){return {path,quiz:null,errors:[`JSON 解析失败：${e.message}`]};}
  return {path,quiz,errors:Q.quizErrors(quiz,graphs)};
}

const empty=week=>({week,attempts:[],graded:{}});
function parseAnswers(text,week){
  if(text==null||!String(text).trim())return empty(week);
  const doc=JSON.parse(text);
  if(!doc||!Array.isArray(doc.attempts))throw Error('作答文件格式不对：缺少 attempts 数组');
  return {graded:{},...doc};
}
// 一条作答一行：文件会越写越长，git diff 和人眼都按行看。
const serialize=doc=>`{"week":${JSON.stringify(doc.week)},"graded":${JSON.stringify(doc.graded||{})},"attempts":[\n${doc.attempts.map(a=>JSON.stringify(a)).join(',\n')}\n]}\n`;
async function readAnswers(plugin,week){
  const file=plugin.app.vault.getAbstractFileByPath(Q.answersPath(week));
  return parseAnswers(file?await plugin.app.vault.read(file):null,week);
}
/** 原子读改写。读到的文件坏了就抛错，不拿空记录覆盖。 */
async function mutateAnswers(plugin,week,change){
  const file=await ensureFile(plugin.app,Q.answersPath(week),serialize(empty(week)));
  let result;
  await plugin.app.vault.process(file,current=>{const doc=parseAnswers(current,week);result=change(doc)||doc;return serialize(result);});
  return result;
}
const recordAttempt=(plugin,week,attempt)=>mutateAnswers(plugin,week,doc=>({...doc,attempts:[...doc.attempts,attempt]}));

/**
 * 判一门课并写回掌握度。第一次判分时记下各概念原来的档位（before）；
 * 之后因为「这题有问题」重判，档位按新结果再追加一条记录——掌握度只追加，最新的一条生效。
 * 某个概念的题全被标成有问题、不再计分时，把它恢复到判分前的档位。
 */
async function gradeCourse(plugin,week,block,latest){
  const doc=await readAnswers(plugin,week),prev=doc.graded?.[block.course];
  const levels=Q.conceptLevels(block.questions,Q.firstAttempts(doc,block.course));
  const before=prev?.before||Object.fromEntries(block.questions.flatMap(q=>q.concepts).map(c=>[c,latest.get(c)?.level||'unknown']));
  const at=new Date().toISOString(),records=[];
  for(const [concept,{level,questions}] of levels)records.push(Mastery.masteryRecord({concept,course:block.course,level,source:'quiz',at,basis:{week,questions}}));
  for(const concept of Object.keys(prev?.levels||{}))if(!levels.has(concept))records.push(Mastery.masteryRecord({concept,course:block.course,level:before[concept]||'unknown',source:'quiz',at,basis:{week,questions:[]}}));
  await KStore.appendMastery(plugin,records);
  const graded={at,before,levels:Object.fromEntries([...levels].map(([c,v])=>[c,v.level]))};
  await mutateAnswers(plugin,week,d=>({...d,graded:{...d.graded,[block.course]:graded}}));
  return graded;
}
module.exports={quizWeeks,loadQuiz,readAnswers,recordAttempt,gradeCourse,parseAnswers,serialize};
