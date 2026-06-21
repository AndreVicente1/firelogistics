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
    set "EXPORT_ASSET_DIR=dist\windows\assets\web"
    "%GODOT_EXE%" --headless --path "%CD%" --export-release "Windows Desktop"
) else if /I "%TARGET%"=="linux" (
    set "EXPORT_ASSET_DIR=dist\linux\assets\web"
    "%GODOT_EXE%" --headless --path "%CD%" --export-release "Linux"
) else if /I "%TARGET%"=="macos" (
    set "EXPORT_ASSET_DIR=dist\macos\FireLogistics.app\Contents\MacOS\assets\web"
    "%GODOT_EXE%" --headless --path "%CD%" --export-release "macOS"
) else (
    echo ERROR: unknown target "%TARGET%". Use windows, linux or macos.
    popd
    exit /b 1
)

if errorlevel 1 exit /b 1

echo Copying assets/web next to exported binaries...
if not exist "%EXPORT_ASSET_DIR%" mkdir "%EXPORT_ASSET_DIR%"
robocopy "assets\web" "%EXPORT_ASSET_DIR%" /MIR /XD node_modules /NFL /NDL /NJH /NJS /NP
if %ERRORLEVEL% GEQ 8 exit /b 1

if not exist "%EXPORT_ASSET_DIR%\index.html" (
    echo ERROR: exported assets/web is missing index.html.
    popd
    exit /b 1
)

popd
exit /b 0
