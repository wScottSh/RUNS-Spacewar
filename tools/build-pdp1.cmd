@echo off
rem Build a headless SIMH pdp1 simulator with MSVC (no Type 30 display / no SDL).
rem The oracle harness drives via examine/deposit/breakpoints, so the CRT is not needed.
rem Source: open-simh (tools\simh), pinned by the shallow clone. CPU semantics frozen.

set VC="C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set HERE=%~dp0
set SIMH=%HERE%simh
set OUT=%HERE%pdp1.exe

call %VC% >nul 2>&1
if errorlevel 1 ( echo vcvars failed & exit /b 1 )

pushd "%SIMH%"
cl /nologo /O2 /MT /W2 ^
  /D_CRT_SECURE_NO_WARNINGS /D_CRT_NONSTDC_NO_WARNINGS ^
  /I. /IPDP1 ^
  scp.c sim_console.c sim_fio.c sim_timer.c sim_sock.c sim_tmxr.c ^
  sim_ether.c sim_tape.c sim_disk.c sim_serial.c sim_video.c sim_imd.c sim_card.c ^
  PDP1\pdp1_lp.c PDP1\pdp1_cpu.c PDP1\pdp1_stddev.c PDP1\pdp1_sys.c ^
  PDP1\pdp1_dt.c PDP1\pdp1_drm.c PDP1\pdp1_clk.c PDP1\pdp1_dcs.c ^
  /Fe:"%OUT%" ^
  /link ws2_32.lib winmm.lib advapi32.lib
set RC=%errorlevel%
del /q *.obj >nul 2>&1
popd
exit /b %RC%
