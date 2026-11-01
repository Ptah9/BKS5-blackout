@echo off
cd /d "%~dp0"

echo.
echo   FULL DB RESET: accounts, sessions, positions, flags, npc memory
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*backend/server/index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
ping -n 3 127.0.0.1 >nul

node tools\reset-world.mjs --full

powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'node' -ArgumentList 'backend/server/index.js','--dev' -WorkingDirectory '%CD%' -WindowStyle Hidden -RedirectStandardOutput \"$env:TEMP\opencode\dev.out\" -RedirectStandardError \"$env:TEMP\opencode\dev.err\""
ping -n 4 127.0.0.1 >nul

echo.
echo   Server restarted: http://127.0.0.1:8090/  - register a new login.
echo.
