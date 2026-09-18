"use strict";
async function openReading(app,path) {
  const file=app.vault.getAbstractFileByPath(path);
  if(file?.extension!=='md')return app.workspace.openLinkText(path,'','tab');
  const leaf=app.workspace.getLeavesOfType('markdown').find(l=>l.view?.file?.path===path)||app.workspace.getLeaf('tab');
  await leaf.setViewState({type:'markdown',state:{file:path,mode:'preview'},active:true});
  await app.workspace.revealLeaf(leaf);return leaf;
}
module.exports={openReading};
