# codex-workbench · 4.6.0

时间与天气层级增强；聚焦任务自动记录；行动原位编辑与预算提示；返回自动关闭来源 Tab。

详见 [V4.6 实施与验收](../docs/V4.6 实施与验收.md)。


秒级时钟、天气与截止预警；PDF 专注到时交互；返回 Today 修复；响应式与标题去重。

详见 [V4.5 迭代与验收](../docs/V4.5 迭代与验收.md)。

六入口暖色固定视口界面；新增学习热力图、每日番茄钟数量、专注时段与总时长；动态绑定 owner；课程与日记聚合。

本插件可独立验证与部署：

```powershell
node tools/verify.js --plugin codex-workbench
node tools/deploy.js --plugin codex-workbench
```

从上级开发目录运行。发布仅包含 main.js、manifest.json 和可选 styles.css，保留用户 data.json。公开 API 与事件见上级 docs/插件拆分说明.md；本插件更新只修改本目录的 manifest 版本和 CHANGELOG，不要求其他插件同步升版本。
