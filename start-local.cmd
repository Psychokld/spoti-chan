@echo off
setlocal
cd /d "%~dp0"
if not exist "dist\index.html" (
  echo Build frontend first: npm ci ^&^& npm run build
  pause
  exit /b 1
)
where node >nul 2>nul
if not errorlevel 1 (
  node server/index.js
) else if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server/index.js
) else (
  echo Install Node.js 24 or newer, then restart this launcher.
)
pause
