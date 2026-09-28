"use strict";

const {spawn} = require('node:child_process');

// shell.openPath 负责打开目录；Windows 有时会把资源管理器留在 Obsidian 后面。
// 用 Shell.Application 找到正在显示这个目录的窗口，再请求系统将它置前。
const SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ExplorerFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$target = [System.IO.Path]::GetFullPath($env:LOS_FOLDER_TARGET).TrimEnd('\')
$shell = New-Object -ComObject Shell.Application
for ($attempt = 0; $attempt -lt 25; $attempt++) {
  foreach ($window in $shell.Windows()) {
    try {
      $shown = [System.IO.Path]::GetFullPath($window.Document.Folder.Self.Path).TrimEnd('\')
      if ([string]::Equals($shown, $target, [StringComparison]::OrdinalIgnoreCase)) {
        $handle = [IntPtr]$window.HWND
        [void][ExplorerFocus]::ShowWindowAsync($handle, 9)
        [void][ExplorerFocus]::SetForegroundWindow($handle)
        if ([ExplorerFocus]::GetForegroundWindow() -ne $handle) {
          # 一次 Alt 按键让 Windows 允许本次由用户点击触发的前台切换。
          [ExplorerFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
          [ExplorerFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
          [void][ExplorerFocus]::SetForegroundWindow($handle)
        }
        Start-Sleep -Milliseconds 80
        if ([ExplorerFocus]::GetForegroundWindow() -eq $handle) { exit 0 }
      }
    } catch { }
  }
  Start-Sleep -Milliseconds 100
}
exit 1
`;

function focusExplorerFolder(folder) {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise(resolve => {
    const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden','-Command',SCRIPT],{
      windowsHide:true,
      timeout:5000,
      env:{...process.env,LOS_FOLDER_TARGET:folder},
      stdio:'ignore',
    });
    child.once('error',()=>resolve(false));
    child.once('close',code=>resolve(code===0));
  });
}

module.exports = {focusExplorerFolder};
