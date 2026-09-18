"use strict";
const {spawnSync}=require('node:child_process');const path=require('node:path');
const selected=process.argv.slice(2);require('./plugins');
const commands=[['test.js',...selected],['build.js','--stage',...selected],['check.js','--stage',...selected],['smoke.js','--stage',...selected]];
if (!selected.includes('--plugin')) commands.push(['smoke-lifecycle.js'],['smoke-workbench.js'],['smoke-owners.js'],['smoke-recall-cards.js'],['smoke-estimate.js'],['smoke-reading.js'],['smoke-serialization.js'],['smoke-daily.js'],['smoke-timer.js']);
for(const [file,...args] of commands){
 const result=spawnSync(process.execPath,[path.join(__dirname,file),...args],{stdio:'inherit',cwd:path.resolve(__dirname,'..')});
 if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1);
}
