@echo off
setlocal
cd /d "%~dp0"
echo === Kobra Bridge - Windows installation ===
where py >nul 2>&1
if not errorlevel 1 (
  py -3.11 -c "import sys; raise SystemExit(sys.version_info < (3, 11))" >nul 2>&1
  if not errorlevel 1 (
    set "PY=py -3.11"
    goto :python_ok
  )
)
where python >nul 2>&1
if errorlevel 1 goto :missing_python
python -c "import sys; raise SystemExit(sys.version_info < (3, 11))" >nul 2>&1
if errorlevel 1 goto :missing_python
set "PY=python"
:python_ok
if not exist ".venv\Scripts\python.exe" (
  echo Creating virtual environment...
  %PY% -m venv .venv
  if errorlevel 1 goto :failure
)
echo Installing dependencies...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto :failure
if not exist "config\config.ini" (
  copy /y "config\config.ini.example" "config\config.ini" >nul
  if errorlevel 1 goto :failure
)
if not exist "certs" mkdir "certs"
echo.
echo Installation finished.
if not exist "certs\anycubic_slicer.crt" goto :certs_missing
if not exist "certs\anycubic_slicer.key" goto :certs_missing
echo Certificates detected.
goto :done
:certs_missing
echo ACTION REQUIRED: download the upstream anycubic-certs.zip and extract
echo anycubic_slicer.crt and anycubic_slicer.key into the certs folder.
echo https://gitea.it-drui.de/viewit/KX-Bridge-Release/releases
:done
echo Enable printer LAN mode and run start.bat.
pause
exit /b 0
:missing_python
echo ERROR: Python 3.11 or later not found.
echo Install it from https://www.python.org/downloads/windows/
echo Then rerun install.bat.
pause
exit /b 1
:failure
echo ERROR: installation failed. Review the messages above.
pause
exit /b 1
