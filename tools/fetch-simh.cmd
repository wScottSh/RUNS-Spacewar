@echo off
rem Fetch the open-simh source the headless pdp1 build compiles from.
rem Gitignored (142MB nested repo), so a fresh checkout bootstraps with this.
set HERE=%~dp0
if exist "%HERE%simh\.git" ( echo simh already present & exit /b 0 )
git clone --depth 1 https://github.com/open-simh/simh.git "%HERE%simh"
exit /b %errorlevel%
