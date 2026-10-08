@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Install Node.js 20 LTS or newer first.& pause & exit /b 1)
if not exist node_modules (echo Installing server dependencies...& npm install)
echo Starting Counter-Strike: Dust II Online on port 3000...
node server.js
pause
