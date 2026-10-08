@echo off
setlocal
where tailscale >nul 2>nul
if errorlevel 1 (
  echo Tailscale CLI was not found. Install Tailscale and sign in first.
  echo The server can still run normally on port 3000.
) else (
  echo.
  echo ===== TAILSCALE =====
  for /f "delims=" %%I in ('tailscale ip -4') do echo Share: http://%%I:3000
  echo =====================
  echo.
)
call npm start
endlocal
