@echo off
rem Build the canonical PDP-1 MACRO assembler (macro1) with MSVC.
rem Source: open-simh simtools, crossassemblers/macro1/macro1.c (Messenbrink -> Supnik -> Budne).
rem A general tool, not part of what is verified (CONTEXT.md / ADR-0003).

set VC="C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set HERE=%~dp0
set SRC=%HERE%macro1\macro1.c
set OUT=%HERE%macro1\macro1.exe

call %VC% >nul 2>&1
if errorlevel 1 ( echo vcvars failed & exit /b 1 )

pushd "%HERE%macro1"
cl /nologo /O2 /W3 /wd4996 macro1.c /Fe:"%OUT%"
set RC=%errorlevel%
del /q *.obj >nul 2>&1
popd
exit /b %RC%
