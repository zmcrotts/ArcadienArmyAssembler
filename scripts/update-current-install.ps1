$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourceRoot = [IO.Path]::GetFullPath("E:\my own rosterbuilder\release\win-unpacked")
$installRoot = [IO.Path]::GetFullPath("G:\AAA")
$expectedInstallRoot = [IO.Path]::GetFullPath("G:\AAA")
$installedExe = Join-Path $installRoot "Arcadien Army Assembler.exe"
$marker = Join-Path $installRoot ".roster-builder-install"
$appItems = @(
  "locales",
  "resources",
  "chrome_100_percent.pak",
  "chrome_200_percent.pak",
  "d3dcompiler_47.dll",
  "ffmpeg.dll",
  "icudtl.dat",
  "libEGL.dll",
  "libGLESv2.dll",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html",
  "resources.pak",
  "Arcadien Army Assembler.exe",
  "snapshot_blob.bin",
  "v8_context_snapshot.bin",
  "vk_swiftshader.dll",
  "vk_swiftshader_icd.json",
  "vulkan-1.dll"
)
$preservedFolders = @("rosters", "exports", "user-data")

if ($installRoot -ne $expectedInstallRoot) {
  throw "Refusing to update an unexpected installation path: $installRoot"
}
if (!(Test-Path -LiteralPath $marker) -or !(Test-Path -LiteralPath $installedExe)) {
  throw "The required Arcadien installation marker or executable is missing from G:\AAA."
}

function Get-FolderManifest([string]$folder) {
  if (!(Test-Path -LiteralPath $folder)) {
    return @()
  }
  $folderPrefix = $folder.TrimEnd("\") + "\"
  return @(
    Get-ChildItem -LiteralPath $folder -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        [PSCustomObject]@{
          RelativePath = $_.FullName.Substring($folderPrefix.Length)
          Length = $_.Length
          Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
        }
      }
  )
}

$running = @(
  Get-Process -Name "Arcadien Army Assembler" -ErrorAction SilentlyContinue |
    Where-Object {
      try {
        [IO.Path]::GetFullPath($_.MainModule.FileName) -eq $installedExe
      } catch {
        $false
      }
    }
)
foreach ($process in $running) {
  if (!$process.HasExited) {
    [void]$process.CloseMainWindow()
  }
}
if ($running.Count) {
  Wait-Process -Id $running.Id -Timeout 5 -ErrorAction SilentlyContinue
}
foreach ($process in $running) {
  if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $process.Id -Force
  }
}

$preservedBefore = @{}
foreach ($name in $preservedFolders) {
  $preservedBefore[$name] = Get-FolderManifest (Join-Path $installRoot $name)
}

$parent = Split-Path -Parent $installRoot
$token = [Guid]::NewGuid().ToString("N")
$stagingRoot = Join-Path $parent ".AAA.installing-$token"
$backupRoot = Join-Path $parent ".AAA.backup-$token"
$installedItems = [Collections.Generic.List[string]]::new()
$backedUpItems = [Collections.Generic.List[string]]::new()
$completed = $false

try {
  New-Item -ItemType Directory -Path $stagingRoot | Out-Null
  New-Item -ItemType Directory -Path $backupRoot | Out-Null
  foreach ($item in $appItems) {
    $source = Join-Path $sourceRoot $item
    $staged = Join-Path $stagingRoot $item
    if (!(Test-Path -LiteralPath $source)) {
      throw "Release payload item is missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination $staged -Recurse -Force
  }

  foreach ($item in $appItems) {
    $target = Join-Path $installRoot $item
    $backup = Join-Path $backupRoot $item
    $staged = Join-Path $stagingRoot $item
    if (Test-Path -LiteralPath $target) {
      Move-Item -LiteralPath $target -Destination $backup
      $backedUpItems.Add($item)
    }
    Move-Item -LiteralPath $staged -Destination $target
    $installedItems.Add($item)
  }

  foreach ($item in $appItems) {
    if (!(Test-Path -LiteralPath (Join-Path $installRoot $item))) {
      throw "Installed payload validation failed: $item"
    }
  }
  $completed = $true
} catch {
  foreach ($item in @($installedItems)) {
    $target = Join-Path $installRoot $item
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
  foreach ($item in @($backedUpItems)) {
    Move-Item -LiteralPath (Join-Path $backupRoot $item) -Destination (Join-Path $installRoot $item)
  }
  throw
} finally {
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  if ($completed -and (Test-Path -LiteralPath $backupRoot)) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force
  }
}

foreach ($name in $preservedFolders) {
  $after = Get-FolderManifest (Join-Path $installRoot $name)
  $beforeJson = ConvertTo-Json -Compress -Depth 4 -InputObject @($preservedBefore[$name])
  $afterJson = ConvertTo-Json -Compress -Depth 4 -InputObject @($after)
  if ($beforeJson -ne $afterJson) {
    throw "Preserved folder changed during update: $name"
  }
}

$exeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedExe).Hash
$sourceExeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $sourceRoot "Arcadien Army Assembler.exe")).Hash
if ($exeHash -ne $sourceExeHash) {
  throw "Installed executable hash does not match the release executable."
}

[PSCustomObject]@{
  InstallRoot = $installRoot
  ClosedProcesses = $running.Count
  RostersPreserved = @($preservedBefore["rosters"]).Count
  ExportsPreserved = @($preservedBefore["exports"]).Count
  UserDataFilesPreserved = @($preservedBefore["user-data"]).Count
  ExecutableSHA256 = $exeHash
}
