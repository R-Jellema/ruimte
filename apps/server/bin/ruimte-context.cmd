@echo off
rem The same as `ruimte-context` beside it, for cmd and PowerShell on Windows, which cannot run a shell script.
if exist "%~dp0ruimte.exe" (
    "%~dp0ruimte.exe" context %*
) else (
    bun "%~dp0..\src\main.ts" context %*
)
exit /b %ERRORLEVEL%
