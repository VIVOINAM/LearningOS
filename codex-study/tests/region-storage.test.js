const test=require('node:test'),assert=require('node:assert/strict');
const {StorageManager,reference,vaultPath,validRect}=require('../core/storage-manager.ts');
test('区域路径拒绝绝对路径、穿越与双链注入',()=>{
  for(const p of ['/tmp/a','C:/secret','../x','a/../x','a\\b','a//b','a|b','a#b','a\n'])assert.throws(()=>vaultPath(p));
  assert.equal(vaultPath('附件/公式.png'),'附件/公式.png');
  assert.throws(()=>validRect({x:.9,y:0,w:.2,h:1}));assert.throws(()=>validRect({x:NaN,y:0,w:1,h:1}));
});
test('双链携带归一化坐标，图片与页码均使用 Vault 相对路径',()=>{
  const result=reference('数学/课本.pdf',{page:38,rects:[{x:.1,y:.2,w:.5,h:.12}],imagePath:'附件/公式.png'});
  assert.equal(result,'![[附件/公式.png]] [[数学/课本.pdf#page=38&studyRect=0.1,0.2,0.5,0.12|第38页跳转]]');
});
test('切片与元数据仅使用 Vault API，保存失败传递且旧数据不被清空',async()=>{
  const files=new Map(),calls=[];
  const vault={getAbstractFileByPath:p=>files.get(p),createFolder:async p=>files.set(p,{path:p}),
    createBinary:async(p,data)=>{calls.push(p);files.set(p,{path:p,data});},
    create:async(p,text)=>files.set(p,{path:p,text}),modify:async(f,t)=>{f.text=t;},read:async f=>f.text};
  vault.adapter={exists:async p=>files.has(p),read:async p=>files.get(p).text,write:async(p,text)=>files.set(p,{path:p,text})};
  const store=new StorageManager(vault),data=new Uint8Array([137,80,78,71]).buffer;
  const first=await store.saveCrop('课本.pdf',38,data),second=await store.saveCrop('课本.pdf',38,data);
  assert.notEqual(first,second);assert.equal(files.get(first).data,data);assert.equal(calls.length,2);
  await store.saveMetadata({study:{records:{old:true}}});assert.deepEqual(await store.loadMetadata(),{study:{records:{old:true}}});
  vault.adapter.write=async()=>{throw Error('disk full');};await assert.rejects(store.saveMetadata({study:{}}),/disk full/);
  assert.deepEqual(await store.loadMetadata(),{study:{records:{old:true}}});
});
