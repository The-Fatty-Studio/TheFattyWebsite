<#
.SYNOPSIS
  Turns the published Windows ZIP into the Setup .exe installer, without a Unity build.

.DESCRIPTION
  Downloads the current Windows ZIP from the site (or uses -Zip), unpacks it, and runs Inno Setup
  with the game repo's Installer\TheFatty.iss. Needs Inno Setup 6 (winget install --id JRSoftware.InnoSetup -e).
  Then publish the result with release-windows.cmd.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File make-installer-from-zip.ps1 -Iss C:\path\to\TheFattyOriginal\Installer\TheFatty.iss
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File make-installer-from-zip.ps1 -Iss ...\TheFatty.iss -Zip C:\Downloads\TheFatty-Windows-v1.006.zip -Version 1.006.1
#>
param(
    [Parameter(Mandatory = $true)][string]$Iss,
    [string]$Zip,
    [string]$Version,
    [string]$OutDir = (Join-Path $PSScriptRoot 'installer-out')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Iss)) { throw "TheFatty.iss not found: $Iss (it is in the game repo, folder Installer)" }
$Iss = (Resolve-Path $Iss).Path

$script = Get-Content (Join-Path $PSScriptRoot 'script.js') -Raw
$winPath = if ($script -match "const WIN_PATH = '([^']*)';") { $Matches[1] } else { '' }
$winVersion = if ($script -match "const WIN_VERSION = '([^']*)';") { $Matches[1] } else { '' }

$work = Join-Path ([IO.Path]::GetTempPath()) ("fatty-installer-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    if (-not $Zip) {
        if ($winPath -notmatch '\.zip(\?|$)') { throw "No ZIP link in script.js (WIN_PATH = '$winPath'). Pass -Zip <file>." }
        $Zip = Join-Path $work 'game.zip'
        Write-Host "Downloading $winPath ..."
        Invoke-WebRequest -Uri $winPath -OutFile $Zip
    }
    if (-not $Version) { $Version = "$winVersion.1" }
    if ($Version -notmatch '^\d+(\.\d+){1,2}$') { throw "Version must look like 1.006.1, got: $Version" }

    $game = Join-Path $work 'game'
    Write-Host "Extracting ..."
    Expand-Archive -Path $Zip -DestinationPath $game -Force

    # The game exe is the .exe next to its *_Data folder (not Unity's crash handler).
    $exe = Get-ChildItem $game -Recurse -Filter *.exe |
        Where-Object { $_.Name -notlike 'UnityCrashHandler*' -and (Test-Path (Join-Path $_.DirectoryName ($_.BaseName + '_Data'))) } |
        Select-Object -First 1
    if (-not $exe) { throw "Could not find the game exe (an .exe with a matching _Data folder) in the ZIP." }
    Write-Host "Game exe: $($exe.Name)"

    $iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $iscc) { throw "Inno Setup 6 not found. Install it: winget install --id JRSoftware.InnoSetup -e" }

    # Use a copy of the .iss next to the original (it needs TheFatty.ico there), with the exe name that is really in the ZIP.
    $tmpIss = Join-Path (Split-Path $Iss -Parent) 'TheFatty.zip2setup.tmp.iss'
    (Get-Content $Iss -Raw) -replace '(?m)^#define AppExe "[^"]*"', "#define AppExe `"$($exe.Name)`"" | Set-Content $tmpIss -Encoding UTF8
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    try {
        & $iscc "/DAppVersion=$Version" "/DSourceDir=$($exe.DirectoryName)" "/DOutputDir=$OutDir" $tmpIss
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed (exit code $LASTEXITCODE)." }
    } finally {
        Remove-Item $tmpIss -ErrorAction SilentlyContinue
    }
    Write-Host "Done: $(Join-Path $OutDir "TheFatty-Setup-$Version.exe")" -ForegroundColor Green
    Write-Host "Test it, then publish it with release-windows.cmd (version $Version)."
} finally {
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
