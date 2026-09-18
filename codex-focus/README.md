# codex-focus · 5.2.0

移除白噪音：不再合成或播放音频，计时与设置里没有 whiteNoise。

taskId 与 durationSeconds 贯穿计时和会话，按任务统计有效用时。

详见 [V4.6 实施与验收](../docs/V4.6 实施与验收.md)。


新增阅读自动启动与 pause 状态转换；设置/兼容 API 串行保存及回滚；本地白噪音联动。

详见 [V4.5 迭代与验收](../docs/V4.5 迭代与验收.md)。

计时转换与自动结算迁回本插件；独立命令；串行转换、写盘失败回滚、防重复结算。

本插件可独立验证与部署：

```powershell
node tools/verify.js --plugin codex-focus
node tools/deploy.js --plugin codex-focus
```

从上级开发目录运行。发布仅包含 main.js、manifest.json 和可选 styles.css，保留用户 data.json。公开 API 与事件见上级 docs/插件拆分说明.md；本插件更新只修改本目录的 manifest 版本和 CHANGELOG，不要求其他插件同步升版本。
