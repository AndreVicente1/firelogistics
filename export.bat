@echo off
setlocal EnableExtensions

pushd "%~dp0" || exit /b 1

if not defined GODOT_EXE set "GODOT_EXE=%USERPROFILE%\Desktop\Godot_v4.6.2-stable_mono_win64\Godot_v4.6.2-stable_mono_win64.exe"
set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=windows"

if not exist "%GODOT_EXE%" (
    echo ERROR: Godot executable not found:
    echo   %GODOT_EXE%
    popd
    exit /b 1
)

if not exist "export_presets.cfg" (
    copy /Y "export_presets.cfg.example" "export_presets.cfg" >nul
)

echo Exporting Fire Logistics target: %TARGET%

if /I "%TARGET%"=="windows" (
    "%GODOT_EXE%" --headless --path "%CD%" --export-release "Windows Desktop"
) else if /I "%TARGET%"=="linux" (
    "%GODOT_EXE%" --headless --path "%CD%" --export-release "Linux"
) else if /I "%TARGET%"=="macos" (
    "%GODOT_EXE%" --headless --path "%CD%" --export-release "macOS"
) else (
    echo ERROR: unknown target "%TARGET%". Use windows, linux or macos.
    popd
    exit /b 1
)

if errorlevel 1 exit /b 1

echo Copying assets/web next to exported binaries is still TODO for this scaffold.
popd
exit /b 0
