@echo off
setlocal EnableExtensions

pushd "%~dp0" || exit /b 1

echo.
echo Fire Logistics setup
echo ====================

if not exist "assets\web\data" mkdir "assets\web\data"
if not exist ".cache" mkdir ".cache"
if not exist ".godot" mkdir ".godot"
> ".godot\extension_list.cfg" echo res://addons/godot_wry/WRY.gdextension

if exist "OSO_20230101_RASTER.tar.gz" (
    echo OSO archive found locally. It will stay untracked by Git.
) else (
    echo WARNING: OSO_20230101_RASTER.tar.gz not found. Vegetation features will stay disabled.
)

set "LB_DATA=%USERPROFILE%\Desktop\LogisticBuilder\assets\web\data"
if not exist "assets\web\data\france-openmaptiles.pmtiles" if exist "%LB_DATA%\france-openmaptiles.pmtiles" (
    echo Linking France PMTiles from LogisticBuilder...
    powershell -NoProfile -Command "try { New-Item -ItemType HardLink -Path 'assets/web/data/france-openmaptiles.pmtiles' -Target '%LB_DATA%/france-openmaptiles.pmtiles' | Out-Null } catch { Copy-Item '%LB_DATA%/france-openmaptiles.pmtiles' 'assets/web/data/france-openmaptiles.pmtiles' }"
)
if not exist "assets\web\data\world-backdrop.geojson" if exist "%LB_DATA%\world-backdrop.geojson" (
    echo Linking world backdrop from LogisticBuilder...
    powershell -NoProfile -Command "try { New-Item -ItemType HardLink -Path 'assets/web/data/world-backdrop.geojson' -Target '%LB_DATA%/world-backdrop.geojson' | Out-Null } catch { Copy-Item '%LB_DATA%/world-backdrop.geojson' 'assets/web/data/world-backdrop.geojson' }"
)

echo.
echo Building C# projects...
dotnet build
if errorlevel 1 exit /b 1

echo.
echo Setup complete.
popd
exit /b 0
