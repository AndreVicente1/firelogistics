param(
    [int]$MainMaxLines = 180
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

$mainPath = Join-Path $root "src/Main.cs"
$mainLines = (Get-Content $mainPath | Measure-Object -Line).Lines
if ($mainLines -gt $MainMaxLines) {
    throw "src/Main.cs has $mainLines lines; keep it at or below $MainMaxLines."
}

$requiredAssets = @(
    "assets/web/index.html",
    "assets/web/css/game.css",
    "assets/web/js/app.js",
    "assets/web/js/fire-model.js",
    "assets/web/js/fire-simulation.js",
    "assets/web/vendor/maplibre-gl@4.7.1/maplibre-gl.js",
    "assets/web/vendor/maplibre-gl@4.7.1/maplibre-gl.css",
    "assets/web/vendor/pmtiles@4.4.1/pmtiles.js"
)

foreach ($asset in $requiredAssets) {
    if (-not (Test-Path (Join-Path $root $asset))) {
        throw "Required runtime asset is missing: $asset"
    }
}

$tracked = git ls-files
$forbiddenPatterns = @(
    "^OSO_20230101_RASTER\.tar\.gz$",
    "^data-sources/",
    "^\.cache/",
    "^assets/web/data/.*\.pmtiles$",
    "^assets/web/data/terrain-dem/[0-9]+/",
    "^assets/terrain/chunks/(ign|national|pilot)/"
)

foreach ($file in $tracked) {
    $normalized = $file -replace "\\", "/"
    foreach ($pattern in $forbiddenPatterns) {
        if ($normalized -match $pattern) {
            throw "Forbidden generated or heavy file is tracked: $file"
        }
    }
}

Write-Host "Repository contracts passed."
