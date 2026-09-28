"use strict";
/*
 * 左右平衡的思维导图布局。纯函数：节点尺寸由调用方量好传进来，这里只算位置。
 *
 * - 课程居中，第一层（章）分到左右两侧。按讲授顺序切一刀：前面几章放右边、其余放左边，
 *   切在两侧高度最接近的地方。只切一刀是为了阅读顺序是顺时针——右侧从上到下，左侧从下到上，
 *   不会出现「第 3 章在右、第 4 章在左、第 5 章又回到右」。
 * - 每侧是整洁树：子树高度累加，父节点对它的子节点居中；同一个父节点的子节点左缘（左侧是右缘）对齐。
 * - 平衡只看到第 2 层（概念）为止。第 3 层是点开一个概念才长出来的要点，它不能让整章跳到另一侧去。
 */
function subtreeHeight(node,vgap,depth,maxDepth){
  const kids=depth>=maxDepth?[]:node.children||[];
  if(!kids.length)return node.h;
  const sum=kids.reduce((n,c)=>n+subtreeHeight(c,vgap,depth+1,maxDepth),0)+vgap*(kids.length-1);
  return Math.max(node.h,sum);
}

/** 在 order 顺序里切一刀：返回放在右侧的前几个。一个都没有时 0；只有一个时放右边。 */
function splitSides(heights){
  const total=heights.reduce((a,b)=>a+b,0);let best=heights.length,bestGap=Infinity,acc=0;
  for(let k=0;k<=heights.length;k++){
    if(k)acc+=heights[k-1];
    const gap=Math.abs(acc-(total-acc));
    // 差距一样时右边多放一个：右边是开始读的地方。
    if(gap<bestGap-1e-9||(Math.abs(gap-bestGap)<1e-9&&k>best)){best=k;bestGap=gap;}
  }
  return Math.max(heights.length?1:0,best);
}

/**
 * root: {id,w,h,children:[{id,w,h,children:[…]}]}，children 已按显示顺序排好、收起的已去掉。
 * 返回 {nodes: Map(id → {x,y,w,h,left,top,side,depth,parent}), edges:[{from,to,side}], bounds:{left,top,right,bottom}, split}
 * x、y 是节点中心；side 是 1（右）或 -1（左），课程节点是 0。
 */
function layoutMindMap(root,{hgap=56,vgap=14,leafGap=6,balanceDepth=2}={}){
  const nodes=new Map(),edges=[];
  const gapAt=depth=>depth>=3?leafGap:vgap;
  const heightOf=(n,depth)=>{const kids=n.children||[];if(!kids.length)return n.h;return Math.max(n.h,kids.reduce((s,c)=>s+heightOf(c,depth+1),0)+gapAt(depth+1)*(kids.length-1));};
  const place=(node,depth,side,x,top,parent)=>{
    const h=heightOf(node,depth),y=top+h/2;
    nodes.set(node.id,{id:node.id,x,y,w:node.w,h:node.h,left:x-node.w/2,top:y-node.h/2,side,depth,parent});
    const kids=node.children||[];if(!kids.length)return;
    const block=kids.reduce((s,c)=>s+heightOf(c,depth+1),0)+gapAt(depth+1)*(kids.length-1);
    let cursor=y-block/2;
    // 同一个父节点的子节点靠父节点那一侧对齐。
    const edge=x+side*(node.w/2+hgap);
    for(const c of kids){place(c,depth+1,side,edge+side*c.w/2,cursor,node.id);edges.push({from:node.id,to:c.id,side});cursor+=heightOf(c,depth+1)+gapAt(depth+1);}
  };
  const chapters=root.children||[];
  const split=splitSides(chapters.map(c=>subtreeHeight(c,vgap,1,balanceDepth)));
  const right=chapters.slice(0,split),left=chapters.slice(split).reverse();
  nodes.set(root.id,{id:root.id,x:0,y:0,w:root.w,h:root.h,left:-root.w/2,top:-root.h/2,side:0,depth:0,parent:null});
  for(const [side,list] of [[1,right],[-1,left]]){
    if(!list.length)continue;
    const block=list.reduce((s,c)=>s+heightOf(c,1),0)+vgap*2*(list.length-1);
    let cursor=-block/2;const edge=side*(root.w/2+hgap*1.4);
    for(const c of list){place(c,1,side,edge+side*c.w/2,cursor,root.id);edges.push({from:root.id,to:c.id,side});cursor+=heightOf(c,1)+vgap*2;}
  }
  let l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
  for(const n of nodes.values()){l=Math.min(l,n.left);t=Math.min(t,n.top);r=Math.max(r,n.left+n.w);b=Math.max(b,n.top+n.h);}
  return {nodes,edges,bounds:{left:l,top:t,right:r,bottom:b},split};
}

/** 两个框是否重叠（留 gap 的余量）。测试和调试用。 */
const overlaps=(a,b,gap=0)=>a.left<b.left+b.w+gap&&b.left<a.left+a.w+gap&&a.top<b.top+b.h+gap&&b.top<a.top+a.h+gap;

/**
 * 方向键：从 from 往 dir（left/right/up/down）找最近的节点。主方向上必须真的往那边走，
 * 偏离主方向的距离按两倍算——往右按，宁可选稍远但同一行的，也不跳到斜下方去。
 */
function neighbour(nodes,fromId,dir){
  const from=nodes.get(fromId);if(!from)return null;
  const [ax,ay]={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[dir]||[0,0];
  let best=null,score=Infinity;
  for(const n of nodes.values()){
    if(n.id===fromId)continue;
    const dx=n.x-from.x,dy=n.y-from.y,main=dx*ax+dy*ay;
    if(main<=1)continue;
    const side=Math.abs(dx*ay)+Math.abs(dy*ax),s=main+2*side;
    if(s<score){score=s;best=n.id;}
  }
  return best;
}

/** 让 bounds 整个放进 width × height 的视口：返回 {scale,x,y}，x、y 是舞台原点在视口里的位置。 */
function fitView(bounds,width,height,{pad=32,max=1.2,min=.25}={}){
  const bw=bounds.right-bounds.left,bh=bounds.bottom-bounds.top;
  const scale=Math.max(min,Math.min(max,(width-pad*2)/Math.max(1,bw),(height-pad*2)/Math.max(1,bh)));
  return {scale,x:(width-bw*scale)/2-bounds.left*scale,y:(height-bh*scale)/2-bounds.top*scale};
}
module.exports={layoutMindMap,splitSides,overlaps,neighbour,fitView};
