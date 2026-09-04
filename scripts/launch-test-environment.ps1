param(
  [string]$Profile = "receiver",
  [string]$NameSuffix = "-TEST",
  [string]$SourceInstall = "G:\AAA"
)

$ErrorActionPreference = "Stop"
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourceRoot = [IO.Path]::GetFullPath($SourceInstall)
if ($sourceRoot.TrimEnd('\') -ne 'G:\AAA') {
  throw "The production source must be G:\AAA."
}

$safeProfile = ($Profile.ToLowerInvariant() -replace '[^a-z0-9-]+', '-').Trim('-')
if (-not $safeProfile -or $safeProfile.Length -gt 32) {
  throw "Test profile names must contain 1-32 letters, numbers, or hyphens."
}

$testRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot ".test-env\$safeProfile"))
$testBase = [IO.Path]::GetFullPath((Join-Path $projectRoot ".test-env"))
if (-not $testRoot.StartsWith($testBase + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to create a test profile outside the workspace test folder."
}

$sourceStorage = Join-Path $sourceRoot "user-data\Local Storage"
if (-not (Test-Path -LiteralPath $sourceStorage)) {
  throw "The production Local Storage folder was not found at $sourceStorage."
}

$targetUserData = Join-Path $testRoot "user-data"
$targetStorage = Join-Path $targetUserData "Local Storage"
$copyMarker = Join-Path $testRoot ".production-rosters-copied"
if (-not (Test-Path -LiteralPath $copyMarker)) {
  New-Item -ItemType Directory -Force -Path $targetStorage | Out-Null
  Get-ChildItem -LiteralPath $sourceStorage -Force | Where-Object { $_.Name -ne 'LOCK' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $targetStorage -Recurse -Force
  }
  Set-Content -LiteralPath $copyMarker -Value ([DateTime]::UtcNow.ToString('o')) -Encoding UTF8
}

$electron = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electron)) {
  $electron = Join-Path $projectRoot "release\win-unpacked\Arcadien Army Assembler.exe"
  $packagedApp = Join-Path $projectRoot "release\win-unpacked\resources\app.asar"
  $builtIndex = Join-Path $projectRoot "dist-user\index.html"
  if ((Test-Path -LiteralPath $electron) -and (
    -not (Test-Path -LiteralPath $packagedApp) -or
    ((Get-Item -LiteralPath $builtIndex).LastWriteTimeUtc -gt (Get-Item -LiteralPath $packagedApp).LastWriteTimeUtc)
  )) {
    throw "The packaged test executable is stale. Run npm run dist:dir before launching it."
  }
}
if (-not (Test-Path -LiteralPath $electron)) {
  throw "The test executable is missing. Run npm run dist:dir first."
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "dist-user\index.html"))) {
  throw "The share-capable build is missing. Run npm run build:user first."
}

$arguments = @(
  ".",
  "--aaa-test-profile=$safeProfile",
  "--aaa-test-name-suffix=$NameSuffix"
)
$process = Start-Process -FilePath $electron -ArgumentList $arguments -WorkingDirectory $projectRoot -PassThru
Write-Output "AAA TEST profile '$safeProfile' launched (PID $($process.Id))."
Write-Output "Data: $testRoot"
