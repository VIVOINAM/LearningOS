@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "LOG=%~dp0deploy.log"
echo L-OS deploy log > "%LOG%"
echo [%date% %time%] start >> "%LOG%"
where node >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. >> "%LOG%"
  echo Node.js not found. Install Node.js and run again.
  pause
  exit /b 1
)
echo [1/2] build stage >> "%LOG%"
call node tools\verify.js >> "%LOG%" 2>&1
if errorlevel 1 goto :fail
echo [2/2] deploy to .obsidian\plugins >> "%LOG%"
call node tools\deploy.js >> "%LOG%" 2>&1
if errorlevel 1 goto :fail
echo [OK] deploy finished >> "%LOG%"
echo Deploy finished. Back to Obsidian and press Ctrl+R.
pause
exit /b 0
:fail
echo [ERROR] deploy failed. See this file: %LOG% >> "%LOG%"
echo Deploy failed. Details were written to:
echo %LOG%
pause
exit /b 1