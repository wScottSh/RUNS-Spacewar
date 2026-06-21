@echo off
rem Assemble Ground Truth into the Image + symbol listing.
rem -r : pure RIM-format tape (REQUIRED; macro1's default output is NOT SIMH-loadable).
rem -d : dump the symbol table into the .lst (the harness needs label -> address).
rem Output lands in build\ (copy first so macro1 does not write into source\).

set HERE=%~dp0
set ROOT=%HERE%..
set MACRO1=%HERE%macro1\macro1.exe
set SRC=%ROOT%\source\spacewar3.1_complete.txt
set WORK=%ROOT%\build\spacewar31.mac

if not exist "%ROOT%\build" mkdir "%ROOT%\build"
copy /y "%SRC%" "%WORK%" >nul
"%MACRO1%" -r -d "%WORK%"
exit /b %errorlevel%
