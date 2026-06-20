@echo off
setlocal EnableExtensions EnableDelayedExpansion

pushd "%~dp0" || exit /b 1

set "ROOT=%CD%"
if not defined GODOT_EXE set "GODOT_EXE=%USERPROFILE%\Desktop\Godot_v4.6.2-stable_mono_win64\Godot_v4.6.2-stable_mono_win64.exe"
if not defined FL_RAM_MB set "FL_RAM_MB=4096"

set "HEADLESS=0"
set "SHOW_HELP=0"
set "QUIT_AFTER="
set "NEXT_IS_QUIT_AFTER=0"

for %%A in (%*) do (
    set "ARG=%%~A"
    if "!NEXT_IS_QUIT_AFTER!"=="1" (
        set "QUIT_AFTER=!ARG!"
        set "NEXT_IS_QUIT_AFTER=0"
    ) else if /I "!ARG!"=="--help" (
        set "SHOW_HELP=1"
    ) else if /I "!ARG!"=="-h" (
        set "SHOW_HELP=1"
    ) else if /I "!ARG!"=="--headless" (
        set "HEADLESS=1"
    ) else if /I "!ARG!"=="--quit-after" (
        set "NEXT_IS_QUIT_AFTER=1"
    )
)

if "%SHOW_HELP%"=="1" goto :show_help

if not exist "%GODOT_EXE%" (
    echo ERROR: Godot executable not found:
    echo   %GODOT_EXE%
    echo Set GODOT_EXE to your Godot 4.6.2 .NET editor path.
    popd
    exit /b 1
)

call :ensure_extensions

for /f "delims=" %%H in ('powershell -NoProfile -Command "$bytes = [uint64]$env:FL_RAM_MB * 1MB; '0x{0:X}' -f $bytes"') do set "DOTNET_GCHeapHardLimit=%%H"

echo.
echo Fire Logistics
echo ==============
echo Project:  %ROOT%
echo Godot:    %GODOT_EXE%
echo RAM/proc: %FL_RAM_MB% MB ^(DOTNET_GCHeapHardLimit=%DOTNET_GCHeapHardLimit%^)
echo.

if "%HEADLESS%"=="1" (
    if defined QUIT_AFTER (
        "%GODOT_EXE%" --headless --path "%ROOT%" --quit-after %QUIT_AFTER%
    ) else (
        "%GODOT_EXE%" --headless --path "%ROOT%"
    )
) else (
    if defined QUIT_AFTER (
        "%GODOT_EXE%" --path "%ROOT%" --quit-after %QUIT_AFTER%
    ) else (
        "%GODOT_EXE%" --path "%ROOT%"
    )
)

popd
exit /b %ERRORLEVEL%

:ensure_extensions
if not exist ".godot" mkdir ".godot"
> ".godot\extension_list.cfg" echo res://addons/godot_wry/WRY.gdextension
exit /b 0

:show_help
echo.
echo Fire Logistics run
echo ==================
echo.
echo Usage:
echo   ./run
echo   run.bat
echo   run.bat --headless
echo   ./run --headless --quit-after 1
echo.
echo Environment:
echo   GODOT_EXE    Path to Godot 4.6.2 .NET editor
echo   FL_RAM_MB    Managed heap limit in MB ^(default: 4096^)
echo.
popd
exit /b 0
