@echo off
setlocal EnableExtensions

pushd "%~dp0" || exit /b 1

set "GODOT_EXE=%USERPROFILE%\Desktop\Godot_v4.6.2-stable_mono_win64\Godot_v4.6.2-stable_mono_win64.exe"

echo.
echo Fire Logistics test suite
echo =========================

echo.
echo Building Godot/C# project...
dotnet build
if errorlevel 1 exit /b 1

echo.
echo Running Core tests...
dotnet test tests\FireLogistics.Core.Tests\FireLogistics.Core.Tests.csproj
if errorlevel 1 exit /b 1

where node.exe >nul 2>nul
if errorlevel 1 (
    echo WARNING: node.exe is required for web tests. Skipping web tests.
) else (
    echo.
    echo Running web helper tests...
    node --test tests\web\app.test.js tests\web\terrain-dem.test.js
    if errorlevel 1 exit /b 1
)

if exist "%GODOT_EXE%" (
    echo.
    echo Running Godot headless smoke test...
    if not exist ".godot" mkdir ".godot"
    > ".godot\extension_list.cfg" echo res://addons/godot_wry/WRY.gdextension
    "%GODOT_EXE%" --headless --path "%CD%" --quit-after 1
    if errorlevel 1 exit /b 1
) else (
    echo.
    echo WARNING: Godot executable not found at:
    echo   %GODOT_EXE%
    echo Skipping Godot headless smoke test.
)

echo.
echo All available tests passed.
popd
exit /b 0
