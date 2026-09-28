// Runtime storage uses only Obsidian Vault APIs. No filesystem or network imports.
type Rect = { x: number; y: number; w: number; h: number };
type Clip = { page: number; rects: Rect[]; imagePath?: string; text?: string; note?: string };

function vaultPath(value: string): string {
  if (!value || /[\\:#|\[\]\x00-\x1f]/.test(value) || value.startsWith('/') || value.split('/').some(s => !s || s === '.' || s === '..'))
    throw Error('必须使用 Vault 内部的相对路径。');
  return value;
}
function validRect(r: Rect): Rect {
  if (!r || ![r.x,r.y,r.w,r.h].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.w <= 0 || r.h <= 0 || r.x+r.w > 1.00001 || r.y+r.h > 1.00001)
    throw Error('区域坐标无效。');
  return r;
}
function reference(path: string, a: Clip): string {
  vaultPath(path);
  const r=a.rects?.[0];
  // Explicit normalized coordinate version; never pretend these are PDF native rect units.
  const region=r ? '&studyRect='+[validRect(r).x,r.y,r.w,r.h].map(n=>Number(n.toFixed(7))).join(',') : '';
  const link=`[[${path}#page=${a.page}${region}|第${a.page}页跳转]]`;
  return (a.imagePath ? `![[${vaultPath(a.imagePath)}]] ` : a.text ? a.text.split('\n').map(s=>'> '+s).join('\n')+'\n\n' : '')+link+(a.note?'\n\n'+a.note:'');
}
class StorageManager {
  vault: any;
  constructor(vault: any) { this.vault=vault; }
  async loadMetadata() {
    // JSON may not be indexed by Vault, especially during plugin startup.
    const path='03 知识库/教材切片/学习元数据.json';
    if(!await this.vault.adapter.exists(path))return null;
    const data=JSON.parse(await this.vault.adapter.read(path));
    if(!data?.study?.records||typeof data.study.records!=='object'||Array.isArray(data.study.records))throw Error('学习元数据结构无效，已停止加载以保护原文件。');
    return data;
  }
  async saveMetadata(data:any) {
    await this.folder('03 知识库/教材切片');
    const path='03 知识库/教材切片/学习元数据.json',text=JSON.stringify(data,null,2);
    await this.vault.adapter.write(path,text);
  }
  async folder(path: string) {
    vaultPath(path);
    let current='';
    for(const part of path.split('/')) {
      current=current?current+'/'+part:part;
      if(!await this.vault.adapter.exists(current)) {
        try { await this.vault.createFolder(current); }
        catch(e) { if(!await this.vault.adapter.exists(current))throw e; }
      }
    }
  }
  async saveCrop(path: string, page: number, data: ArrayBuffer, folder='03 知识库/教材切片'): Promise<string> {
    vaultPath(path);await this.folder(folder);
    const name=path.split('/').pop()!.replace(/\.pdf$/i,'').replace(/[<>"?*]/g,'_').slice(0,80);
    const id=Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    const target=vaultPath(`${folder}/${name}_p${page}_crop_${id}.png`);
    await this.vault.createBinary(target,data);return target;
  }
}
module.exports={StorageManager,reference,vaultPath,validRect};
