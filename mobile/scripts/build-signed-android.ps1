$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$mobileRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$gradleConfig = Get-Content -Raw -LiteralPath (Join-Path $mobileRoot "android\app\build.gradle")
if ($gradleConfig -notmatch 'versionName\s+"([^"]+)"') {
  throw "Android versionName is missing from android/app/build.gradle."
}
$version = [string]$Matches[1]
$androidHome = Join-Path $mobileRoot ".android-toolchain\android-sdk"
$javaHome = Join-Path $mobileRoot ".android-toolchain\jdk"
$gradle = Join-Path $mobileRoot ".android-toolchain\gradle-8.9\bin\gradle.bat"
$apksigner = Join-Path $androidHome "build-tools\35.0.0\apksigner.bat"
$userProfile = [Environment]::GetFolderPath("UserProfile")
$keystore = Join-Path $userProfile ".android\arcadien-sideload.jks"
$protectedPassword = Join-Path $userProfile ".android\arcadien-sideload.password.dpapi"
$alias = "arcadien"
$expectedCertificate = "6c4e763199b7ed7ce41383d6ebd71ca9331bcf13bd8aa77762aac9c59b30900b"
$sourceApk = Join-Path $mobileRoot "android\app\build\outputs\apk\sideload\app-sideload.apk"
$releaseApk = Join-Path $mobileRoot "release\Arcadien Army Assembler Android $version.apk"

foreach ($requiredPath in @($androidHome, $javaHome, $gradle, $apksigner, $keystore, $protectedPassword)) {
  if (!(Test-Path -LiteralPath $requiredPath)) {
    throw "Required Android signing input is missing: $requiredPath"
  }
}

$securePassword = (Get-Content -Raw -LiteralPath $protectedPassword).Trim() | ConvertTo-SecureString
$credential = [PSCredential]::new("arcadien-signing", $securePassword)
$password = $credential.GetNetworkCredential().Password
$signingVariables = @(
  "ARCADIEN_KEYSTORE_FILE",
  "ARCADIEN_KEYSTORE_PASSWORD",
  "ARCADIEN_KEY_ALIAS",
  "ARCADIEN_KEY_PASSWORD"
)
$previousEnvironment = @{}
foreach ($name in $signingVariables) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

Push-Location $mobileRoot
try {
  & npm.cmd run android:assets
  if ($LASTEXITCODE -ne 0) {
    throw "Android asset build failed with exit code $LASTEXITCODE."
  }

  $env:JAVA_HOME = $javaHome
  $env:ANDROID_HOME = $androidHome
  $env:ANDROID_SDK_ROOT = $androidHome
  $env:ARCADIEN_KEYSTORE_FILE = $keystore
  $env:ARCADIEN_KEYSTORE_PASSWORD = $password
  $env:ARCADIEN_KEY_ALIAS = $alias
  $env:ARCADIEN_KEY_PASSWORD = $password

  & $gradle -p android :app:assembleSideload
  if ($LASTEXITCODE -ne 0) {
    throw "Signed Android build failed with exit code $LASTEXITCODE."
  }
  if (!(Test-Path -LiteralPath $sourceApk)) {
    throw "The signed Android build did not produce $sourceApk."
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $releaseApk) | Out-Null
  Copy-Item -LiteralPath $sourceApk -Destination $releaseApk -Force

  $certificateOutput = & $apksigner verify --print-certs $releaseApk
  if ($LASTEXITCODE -ne 0) {
    throw "APK signature verification failed."
  }
  $certificateText = $certificateOutput -join "`n"
  if ($certificateText -notmatch [regex]::Escape($expectedCertificate)) {
    throw "The APK was not signed with the permanent Arcadien release certificate."
  }

  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $releaseApk).Hash
  Write-Output "Signed Android release: $releaseApk"
  Write-Output "SHA-256: $hash"
} finally {
  foreach ($name in $signingVariables) {
    [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
  }
  $password = $null
  $credential = $null
  $securePassword = $null
  Pop-Location
}
