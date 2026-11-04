@echo off
rem Double-click to publish the Windows build (ZIP), or drag a .zip file onto this file.
rem Runs update-windows.sh in Git Bash from this folder; the window stays open at the end.
cd /d "%~dp0"
set "GITBASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%GITBASH%" set "GITBASH=%ProgramFiles(x86)%\Git\bin\bash.exe"
if not exist "%GITBASH%" (
  echo Git for Windows was not found. Install it from https://git-scm.com first.
  pause
  exit /b 1
)
if "%~1"=="" (
  "%GITBASH%" -c "./update-windows.sh"
) else (
  "%GITBASH%" -c "./update-windows.sh \"$0\"" "%~1"
)
echo.
pause
