"use strict";
// Real note content in a browser fixture; does not emulate Obsidian's MathJax or virtual renderer.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const deps = process.env.LOS_NODE_MODULES || 'C:/Users/longf/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(path.join(deps, 'playwright'));
const root = path.resolve(__dirname, '..'), vault = path.resolve(root, '..');
const notesRoot = path.join(vault, '03 知识库/我的课程/2026-27/课堂笔记');
const out = path.resolve(vault, '../workbench-checks/note-pages');
const walk = dir => fs.readdirSync(dir, {withFileTypes:true}).flatMap(x => x.isDirectory() ? walk(path.join(dir,x.name)) : [path.join(dir,x.name)]);
// NOTE_SHOTS=<文件名片段>：把匹配笔记的每一页截图到 note-pages/pages/，写完一篇逐页审断页用。
const shots = process.env.NOTE_SHOTS || '';
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
(async () => {
  const { marked } = await import(require('node:url').pathToFileURL(path.join(deps,'marked/lib/marked.esm.js')).href);
  fs.mkdirSync(out,{recursive:true});
  const files = walk(notesRoot).filter(x=>x.endsWith('.md'));
  const report = { scope:'Browser fixture, actual Markdown and images; formulas shown as source, no Obsidian virtual rendering', notes:[], brokenImages:[] };
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    for (const viewport of [{width:1280,height:800},{width:900,height:620}]) {
      const page = await browser.newPage({viewport, reducedMotion:'reduce'});
      let shotName = null;
      await page.exposeFunction('pageShot', async i => { if (shotName) await page.screenshot({path:path.join(out,'pages',`${shotName}-${viewport.width}-${String(i+1).padStart(2,'0')}.png`)}); });
      for (const file of files) {
        let md=fs.readFileSync(file,'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'');
        const formula=[];
        md=md.replace(/\$\$([\s\S]*?)\$\$/g,(_,s)=>{formula.push(s);return `\n\n<div class="math-block"><pre>${esc(s.trim())}</pre></div>\n\n`;});
        md=md.replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g,(_,s)=>{
          // Obsidian resolves wikilinks by basename; standard Markdown resolves relative paths.
          const matches=walk(notesRoot).filter(x=>path.basename(x)===s);
          const target=matches.length===1?path.relative(path.dirname(file),matches[0]).replaceAll('\\','/'):s;
          return `![](${encodeURI(target)})`;
        });
        let html=marked.parse(md);
        html=html.replace(/<img([^>]*?)src="([^"]+)"/g,(_,attrs,src)=>{
          src=decodeURIComponent(src.replaceAll('&amp;','&'));
          if (/^(https?:|data:)/.test(src)) return `<img${attrs}src="${esc(src)}"`;
          const candidates=[path.resolve(path.dirname(file),src),path.resolve(vault,src)];
          const found=candidates.find(x=>fs.existsSync(x));
          if(!found){report.brokenImages.push({file,src});return `<img${attrs}src="missing"`;}
          const mime=found.endsWith('.svg')?'image/svg+xml':found.endsWith('.jpg')?'image/jpeg':'image/png';
          return `<img${attrs}src="data:${mime};base64,${fs.readFileSync(found).toString('base64')}"`;
        });
        shotName = shots && file.includes(shots) ? path.basename(file,'.md') : null;
        if (shotName) fs.mkdirSync(path.join(out,'pages'),{recursive:true});
        await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;font:18px/1.8 'Microsoft YaHei',sans-serif}.lr-host{height:100vh}.markdown-reading-view{height:100%}.markdown-preview-view{height:100%;overflow:auto;padding:20px 36px}.markdown-preview-sizer{max-width:820px;margin:auto}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:6px}blockquote{border-left:3px solid #bbb;padding:8px 18px}pre{white-space:pre-wrap;overflow-wrap:anywhere}p{overflow-wrap:anywhere}</style><div class="lr-host"><div class="markdown-reading-view"><div class="markdown-preview-view class-note"><div class="markdown-preview-sizer">${html}</div></div></div></div>`);
        await page.addStyleTag({content:fs.readFileSync(path.join(root,'l-os-workbench/reading-rail.css'),'utf8')});
        await page.evaluate(async()=>{await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
        await page.addScriptTag({content:`window.module={exports:{}};\n${fs.readFileSync(path.join(root,'l-os-workbench/reading-pager.js'),'utf8')}\nwindow.P=module.exports;`});
        // 课堂回顾的「几页」不翻页，直接在排好的版上数（note-pages.js）。它和真翻页器必须数出同样多页。
        await page.addScriptTag({content:`window.module={exports:{}};(()=>{const require=()=>window.P;\n${fs.readFileSync(path.join(root,'l-os-workbench/note-pages.js'),'utf8')}\n})();window.NP=module.exports;`});
        await page.evaluate(()=>{window.pager=new P.Pager(document.querySelector('.lr-host'),{active:()=>true});pager.set(true);});
        await page.waitForTimeout(80);
        const result=await page.evaluate(async()=>{
          const pages=[];let covered=null;
          for(let i=0;i<1000;i++){
            pager.paint();const g=pager.geometry();
            if(covered!=null&&Math.abs(pager.start-covered)>1)throw Error(`Gap/overlap ${pager.start-covered}`);
            if(pager.end<=pager.start)throw Error('No progress');
            pages.push({start:pager.start,end:pager.end});covered=pager.end;await window.pageShot(i);
            if(pager.atEnd(g))break;
            await pager.flip(1);
          }
          if(pages.length===1000)throw Error('Cannot reach end');
          for(let i=pages.length-2;i>=0;i--){await pager.flip(-1);if(Math.abs(pager.start-pages[i].start)>1)throw Error('Back navigation mismatch');}
          const g=pager.geometry(),counted=NP.countPages(g.sizer,g.view,g.height,window);
          if(Math.ceil(counted)!==pages.length)throw Error(`countPages ${counted} ≠ pager ${pages.length}`);
          return {pages:pages.length,counted:Math.round(counted*10)/10,images:document.images.length,formulas:document.querySelectorAll('.math-block').length};
        });
        const row={file:path.relative(vault,file),viewport,...result};report.notes.push(row);console.log(JSON.stringify(row));
        if(file.includes('2026-09-24 静力学'))await page.screenshot({path:path.join(out,`statics-${viewport.width}.png`)});
        await page.evaluate(()=>pager.dispose());
      }
      await page.close();
    }
  } finally {await browser.close();}
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
  assert.equal(report.brokenImages.length,0,JSON.stringify(report.brokenImages));
  console.log(`PASS: ${files.length} notes × 2 sizes, forwards/backwards, no coverage gaps.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
