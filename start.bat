@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Kobra Bridge is not installed. Run install.bat first.
  pause
  exit /b 1
)
if not exist "certs\anycubic_slicer.crt" goto :certs_missing
if not exist "certs\anycubic_slicer.key" goto :certs_missing
echo Starting Kobra Bridge...
echo Open http://localhost:7125 in your browser.
echo Keep this window open while using the bridge.
".venv\Scripts\python.exe" kobrax_moonraker_bridge.py
echo.
echo Kobra Bridge stopped.
pause
exit /b 0
:certs_missing
echo Missing Anycubic LAN TLS certificates.
echo See https://gitea.it-drui.de/viewit/KX-Bridge-Release/releases
echo Extract anycubic_slicer.crt and anycubic_slicer.key into the certs folder.
pause
exit /b 1
