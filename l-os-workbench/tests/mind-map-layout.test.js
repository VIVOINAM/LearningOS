"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../mind-map-layout');
const leaf=(id,w=90,h=28)=>({id,w,h,children:[]});
const chapter=(id,n,extra=[])=>({id,w:120,h:30,children:[...Array.from({length:n},(_,i)=>leaf(`${id}-${i}`,80+(i%3)*40)),...extra]});

test('只切一刀：右侧是前几章、左侧是后几章，两侧高度接近',()=>{
  assert.equal(L.splitSides([100,100,100,100]),2);
  assert.equal(L.splitSides([300,100,100,100]),1);
  assert.equal(L.splitSides([100]),1);
  assert.equal(L.splitSides([]),0);
  // 差距相同时右边多放
  assert.equal(L.splitSides([100,100,100]),2);
});

test('左右平衡、顺时针阅读、互不重叠、父节点对子节点居中',()=>{
  const root={id:'root',w:160,h:40,children:[chapter('a',5),chapter('b',6),chapter('c',4),chapter('d',1),{id:'e',w:150,h:30,children:[]}]};
  const {nodes,bounds,split}=L.layoutMindMap(root);
  const side=id=>nodes.get(id).side;
  assert.deepEqual(['a','b','c','d','e'].map(side),['a','b','c','d','e'].map((_,i)=>i<split?1:-1));
  assert.ok(split>=1&&split<5);
  // 右侧从上到下是讲授顺序；左侧从下到上继续。
  const right=['a','b','c','d','e'].filter(id=>side(id)===1),left=['a','b','c','d','e'].filter(id=>side(id)===-1);
  for(let i=1;i<right.length;i++)assert.ok(nodes.get(right[i]).y>nodes.get(right[i-1]).y);
  for(let i=1;i<left.length;i++)assert.ok(nodes.get(left[i]).y<nodes.get(left[i-1]).y);
  // 两侧的总高度差不超过最高的一章
  const span=s=>{const ns=[...nodes.values()].filter(n=>n.side===s);return Math.max(...ns.map(n=>n.top+n.h))-Math.min(...ns.map(n=>n.top));};
  assert.ok(Math.abs(span(1)-span(-1))<=7*28+6*14,`${span(1)} vs ${span(-1)}`);
  const all=[...nodes.values()];
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)assert.ok(!L.overlaps(all[i],all[j]),`${all[i].id} 与 ${all[j].id} 重叠`);
  // 父节点在子节点的纵向中点
  const kids=all.filter(n=>n.parent==='b');
  assert.ok(Math.abs(nodes.get('b').y-(Math.min(...kids.map(k=>k.y))+Math.max(...kids.map(k=>k.y)))/2)<0.5);
  // 同一父节点的子节点左缘对齐（右侧）或右缘对齐（左侧）
  const edgeOf=n=>n.side===1?n.left:n.left+n.w;
  for(const p of ['a','b','c'])assert.equal(new Set(all.filter(n=>n.parent===p).map(n=>Math.round(edgeOf(n)))).size,1);
  assert.ok(bounds.left<0&&bounds.right>0);
});

test('展开第三层要点不会让章节换边',()=>{
  const base=()=>({id:'root',w:160,h:40,children:[chapter('a',4),chapter('b',4),chapter('c',4),chapter('d',4)]});
  const before=L.layoutMindMap(base());
  const grown=base();grown.children[1].children[0].children=Array.from({length:12},(_,i)=>leaf(`p${i}`,200,22));
  const after=L.layoutMindMap(grown);
  assert.equal(after.split,before.split);
  const all=[...after.nodes.values()];
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)assert.ok(!L.overlaps(all[i],all[j]),`${all[i].id} 与 ${all[j].id} 重叠`);
});

test('方向键找相邻节点；适应窗口把整张图放进视口',()=>{
  const {nodes,bounds}=L.layoutMindMap({id:'root',w:160,h:40,children:[chapter('a',3),chapter('b',3)]});
  const right=L.neighbour(nodes,'root','right'),leftN=L.neighbour(nodes,'root','left');
  assert.equal(nodes.get(right).side,1);assert.equal(nodes.get(leftN).side,-1);
  assert.equal(nodes.get(L.neighbour(nodes,'a','right')).parent,'a');
  assert.equal(L.neighbour(nodes,'root','up')&&nodes.get(L.neighbour(nodes,'root','up')).y<0,true);
  const v=L.fitView(bounds,800,500);
  assert.ok(bounds.left*v.scale+v.x>=31&&bounds.right*v.scale+v.x<=769);
  assert.ok(bounds.top*v.scale+v.y>=31&&bounds.bottom*v.scale+v.y<=469);
});
