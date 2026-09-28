'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const moduleStub={exports:{}};
const notices=[];
vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync(require.resolve('../core/pdf-overlay.ts'),'utf8')),{module:moduleStub,require:()=>({Notice:class{constructor(message){notices.push(message);}}}),setTimeout,clearTimeout,Blob});
const {PdfOverlay}=moduleStub.exports;
function fixture(selection=null){
  const overlay=Object.create(PdfOverlay.prototype);
  Object.assign(overlay,{token:0,quick:false,armed:false,busy:false,ctx:{path:'book.pdf',win:{getSelection:()=>selection},scroll:{classList:{add(){},remove(){}},contains:()=>true}},engine:{}});
  return overlay;
}
test('快捷键进入一次性模式，再按取消；不打开菜单',async()=>{
  const o=fixture();await o.quickCapture();assert.equal(o.quick,true);assert.equal(o.armed,true);
  await o.quickCapture();assert.equal(o.quick,false);assert.equal(o.armed,false);
});
test('选区自动合并为带边距截图，保持原公式排版',async()=>{
  const canvas={width:1000,getBoundingClientRect:()=>({left:0,top:0,width:1000,height:1000})};
  const page={dataset:{pageNumber:'3'},querySelector:()=>canvas};
  const node={nodeType:1,closest:()=>page};
  const selection={rangeCount:1,isCollapsed:false,getRangeAt:()=>({startContainer:node,endContainer:node,getClientRects:()=>[{left:100,top:200,right:300,bottom:240,width:200,height:40},{left:150,top:240,right:250,bottom:260,width:100,height:20}]})};
  const o=fixture(selection);let saved;
  o.saveQuick=async(...args)=>{saved=args;};await o.quickCapture();
  assert.equal(saved[0],3);assert.equal(saved[1].x,.096);assert.equal(saved[1].y,.196);
  assert.ok(Math.abs(saved[1].w-.208)<1e-9);assert.ok(Math.abs(saved[1].h-.068)<1e-9);
});
test('快速保存防重复，图片和注记都持久化',async()=>{
  const o=fixture();let release;let images=0,notes=0;
  o.engine={clips:{saveCrop:async()=>{images++;await new Promise(r=>release=r);return 'clip.png';}},add:async(path,note)=>{notes++;assert.equal(note.imagePath,'clip.png');assert.equal(note.kind,'crop');}};
  const pending=o.saveQuick(1,{x:0,y:0,w:.2,h:.2},{},new ArrayBuffer(1));
  await o.saveQuick(1,{},{},new ArrayBuffer(1));release();await pending;
  assert.equal(images,1);assert.equal(notes,1);assert.equal(o.busy,false);
});
test('保存失败释放忙碌状态并向调用者报告',async()=>{
  const o=fixture();o.engine={clips:{saveCrop:async()=>{throw Error('disk full');}}};
  await assert.rejects(o.saveQuick(1,{},{},new ArrayBuffer(1)),/disk full/);assert.equal(o.busy,false);
});
