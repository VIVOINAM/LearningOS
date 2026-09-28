"use strict";
/**
 * 自编教材：一篇登记表笔记 + book/ 里的 PDF。
 *
 * 登记表是普通 Markdown，人和 agent 都能直接改，不另起一份 JSON：
 *
 *   ## 数学体系            ← 二级标题是系列
 *   - 计划：[[book/README]]  ← 系列下、第一本书之前的字段是整个系列的缺省值
 *   - 下一步：……            ← 例外：系列的「下一步」「说明」说的是整个系列，只挂在系列上，不抄给每本书
 *   ### 卷1·……             ← 三级标题是一本书
 *   - 状态：已完成
 *   - PDF：[[book/卷1·….pdf]]
 *   - 进度：7/7 篇
 *   - 页数：197/200
 *
 * book/ 里有、登记表里没有的 PDF 不藏起来，归进「未登记」——
 * 新导出一本书，哪怕忘了登记，这一页也看得见它。
 */
const REGISTRY = '04 创作/自编教材.md';
const BOOK_DIR = 'book/';
const STATUS = ['计划中','编写中','暂停','已完成'];
// 项目笔记的 status 是另一套词：计划跟着项目走时，按这张表换成教材的状态。
const PROJECT_STATUS = {'完成':'已完成','已完成':'已完成','进行中':'编写中','暂停':'暂停','搁置':'暂停','未开始':'计划中','计划':'计划中'};
const FIELDS = {'系列':'series','状态':'status','pdf':'pdf','源目录':'source','计划':'plan','进度':'progress','页数':'pages','下一步':'next','截止':'due','更新':'updated','说明':'note'};

/** [[目标|别名]] → 目标；<路径> 与 `路径` 去掉包裹。其余原样。 */
function linkTarget(value) {
  const text = String(value || '').trim();
  const wiki = text.match(/^!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/);
  if (wiki) return wiki[1].trim();
  const md = text.match(/^\[[^\]]*\]\(<?([^)>]+)>?\)$/);
  if (md) { try { return decodeURIComponent(md[1].trim()); } catch { return md[1].trim(); } }
  return text.replace(/^[<`]|[>`]$/g, '').trim();
}
/** 「7/7 篇」「3 / 12 章」→ {done, total, unit}；「197」→ {done:197, total:0}。读不出返回 null。 */
function ratio(value) {
  const m = String(value || '').match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*(\S*)/);
  if (!m) return null;
  return {done:Number(m[1]), total:m[2] ? Number(m[2]) : 0, unit:m[3] || ''};
}
function normalizeStatus(value) {
  const text = String(value || '').trim();
  return STATUS.includes(text) ? text : PROJECT_STATUS[text] || (text ? text : '');
}

function parseRegistry(text) {
  const series = [];
  let group = null, book = null;
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/<!--[\s\S]*?-->/g, '');
  let fence = false;
  for (const raw of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const h = raw.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (h) {
      if (h[1] === '##') { group = {name:h[2], defaults:{}, books:[]}; series.push(group); book = null; }
      else {
        if (!group) { group = {name:'', defaults:{}, books:[]}; series.push(group); }
        book = {title:h[2], fields:{}}; group.books.push(book);
      }
      continue;
    }
    const f = raw.match(/^\s*[-*]\s*([^：:]+?)\s*[：:]\s*(.*)$/);
    if (!f || !group) continue;
    const key = FIELDS[f[1].trim().toLowerCase()] || FIELDS[f[1].trim()];
    if (!key) continue;
    (book ? book.fields : group.defaults)[key] = f[2].trim();
  }
  return series.map(g => ({
    name: g.name,
    next: g.defaults.next || '',
    note: g.defaults.note || '',
    books: g.books.map(b => {
      const {next, note, ...inherited} = g.defaults;
      const v = {...inherited, ...b.fields};
      return {
        title: b.title,
        series: v.series || g.name,
        status: normalizeStatus(v.status),
        pdf: linkTarget(v.pdf),
        source: linkTarget(v.source),
        plan: linkTarget(v.plan),
        progress: ratio(v.progress),
        pages: ratio(v.pages),
        next: v.next || '',
        due: v.due || '',
        updated: v.updated || '',
        note: v.note || '',
      };
    }),
  }));
}

/** 书的完成度，0–1。有进度按进度；没有进度但已完成算满；其余不知道，返回 null——不画假的条。 */
function completion(book) {
  const p = book.progress;
  if (p && p.total > 0) return Math.max(0, Math.min(1, p.done / p.total));
  if (book.status === '已完成') return 1;
  return null;
}

/**
 * 登记表 + 库里的 PDF → 分好组的书单。
 *
 * resolve(path) 把登记表里写的路径换成库里真实的路径（Obsidian 的链接可以省略目录和扩展名），
 * 找不到返回空字符串。plan(path) 取计划笔记的 frontmatter，没有返回 null。
 */
function buildShelf({series = [], pdfs = [], resolve = p => p, plan = () => null} = {}) {
  const claimed = new Set();
  const groups = series.map(group => ({
    name: group.name || '未分组',
    next: group.next || '', note: group.note || '',
    books: group.books.map(book => {
      const pdf = book.pdf ? resolve(book.pdf) : '';
      if (pdf) claimed.add(pdf);
      const planPath = book.plan ? resolve(book.plan) : '';
      const project = planPath ? plan(planPath) : null;
      // 登记表里写了就听登记表；没写的项，跟着计划笔记（项目页里改的状态和下一步）走。
      const status = book.status || normalizeStatus(project?.status) || (pdf ? '已完成' : '计划中');
      return {
        ...book, pdf, planPath, status,
        missingPdf: !!book.pdf && !pdf,
        next: book.next || project?.next || '',
        due: book.due || project?.due || '',
        done: completion({...book, status}),
      };
    }),
  }));
  const stray = pdfs.filter(path => path.startsWith(BOOK_DIR) && !claimed.has(path)).sort();
  if (stray.length) groups.push({name:'未登记', stray:true, books:stray.map(path => ({
    title: path.slice(BOOK_DIR.length).replace(/\.pdf$/i, ''), series:'未登记', status:'已完成',
    pdf:path, planPath:'', source:'', progress:null, pages:null, next:'', due:'', updated:'', note:'', done:1, missingPdf:false,
  }))});
  return groups;
}

/** 页头那一行：共几本，其中在写几本。 */
function shelfSummary(groups) {
  const books = groups.flatMap(g => g.books);
  if (!books.length) return '还没有登记自编教材';
  const count = s => books.filter(b => b.status === s).length;
  return [`${books.length} 本`, count('编写中') ? `${count('编写中')} 本在写` : '', count('计划中') ? `${count('计划中')} 本计划中` : '', `${count('已完成')} 本完成`].filter(Boolean).join(' · ');
}

module.exports = {REGISTRY, BOOK_DIR, STATUS, parseRegistry, buildShelf, shelfSummary, completion, linkTarget, ratio};
