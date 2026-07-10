"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { ensureCrosshairIcon } = require("./write-crosshair-icon");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");
const UNPACKED_DIR = path.join(RELEASE_DIR, "win-unpacked");
const INSTALLER_WORK = path.join(os.tmpdir(), "RosterBuilderLocalInstaller");
const PAYLOAD_ZIP = path.join(INSTALLER_WORK, "roster-builder-app.zip");
const ICON_FILE = path.join(ROOT, "build", "crosshair.ico");
const INSTALLER_ICON = path.join(INSTALLER_WORK, "crosshair.ico");
const APP_NAME = "Arcadien Army Assembler";
const APP_EXE_NAME = `${APP_NAME}.exe`;
const INSTALLER_EXE = path.join(RELEASE_DIR, `${APP_NAME} Setup.exe`);

function assertUnpackedApp() {
  const exe = path.join(UNPACKED_DIR, APP_EXE_NAME);
  if (!fs.existsSync(exe)) {
    throw new Error(`Missing release/win-unpacked/${APP_EXE_NAME}. Run electron-builder --win dir first.`);
  }
}

function run(command, args, options = {}) {
  const { env, ...spawnOptions } = options;
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      DOTNET_CLI_HOME: path.join(RELEASE_DIR, ".cache", "dotnet"),
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
      DOTNET_NOLOGO: "1",
      NUGET_PACKAGES: path.join(RELEASE_DIR, ".cache", "nuget"),
      APPDATA: path.join(RELEASE_DIR, ".cache", "appdata"),
      ...env
    },
    ...spawnOptions
  });
}

function runPowerShell(command) {
  run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);
}

function zipPayload() {
  fs.mkdirSync(INSTALLER_WORK, { recursive: true });
  fs.rmSync(PAYLOAD_ZIP, { force: true });
  const source = path.join(UNPACKED_DIR, "*");
  const escapedSource = source.replace(/'/g, "''");
  const escapedTarget = PAYLOAD_ZIP.replace(/'/g, "''");
  runPowerShell(`Compress-Archive -Path '${escapedSource}' -DestinationPath '${escapedTarget}' -Force`);
  if (!fs.existsSync(PAYLOAD_ZIP)) throw new Error(`Failed to create payload zip: ${PAYLOAD_ZIP}`);
}

function prepareInstallerIcon() {
  ensureCrosshairIcon(ICON_FILE);
  fs.copyFileSync(ICON_FILE, INSTALLER_ICON);
}

function writeDotnetProject() {
  const csproj = String.raw`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net9.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>true</SelfContained>
    <PublishSingleFile>true</PublishSingleFile>
    <EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
    <IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
    <ApplicationIcon>crosshair.ico</ApplicationIcon>
    <DebugType>none</DebugType>
    <DebugSymbols>false</DebugSymbols>
  </PropertyGroup>
  <ItemGroup>
    <EmbeddedResource Include="roster-builder-app.zip" LogicalName="roster-builder-app.zip" />
    <Content Include="crosshair.ico" />
  </ItemGroup>
</Project>
`;

    const program = String.raw`using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;

internal static class Program
{
    private const string AppName = "Arcadien Army Assembler";
    private const string AppExeName = "Arcadien Army Assembler.exe";
    private const string LegacyAppExeName = "Roster Builder.exe";

    private static readonly string[] AppItems =
    {
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
        AppExeName,
        "snapshot_blob.bin",
        "v8_context_snapshot.bin",
        "vk_swiftshader.dll",
        "vk_swiftshader_icd.json",
        "vulkan-1.dll"
    };

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new InstallForm());
    }

    private sealed class InstallForm : Form
    {
        private readonly TextBox folderTextBox = new();
        private readonly CheckBox desktopShortcutCheckBox = new();
        private readonly Button installButton = new();
        private readonly Label statusLabel = new();

        internal InstallForm()
        {
            Text = "Install Arcadien Army Assembler";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(640, 218);

            var label = new Label
            {
                Text = "Choose where Arcadien Army Assembler should be installed. Saves, exports, and app data will live in this folder too.",
                AutoSize = false,
                Location = new Point(14, 14),
                Size = new Size(610, 38)
            };

            folderTextBox.Location = new Point(16, 64);
            folderTextBox.Size = new Size(496, 24);
            folderTextBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);

            var browseButton = new Button
            {
                Text = "Browse...",
                Location = new Point(528, 62),
                Size = new Size(96, 28)
            };
            browseButton.Click += (_, _) => BrowseForFolder();

            desktopShortcutCheckBox.Text = "Create a desktop shortcut";
            desktopShortcutCheckBox.Checked = true;
            desktopShortcutCheckBox.AutoSize = true;
            desktopShortcutCheckBox.Location = new Point(16, 104);

            var cancelButton = new Button
            {
                Text = "Cancel",
                Location = new Point(424, 158),
                Size = new Size(92, 32),
                DialogResult = DialogResult.Cancel
            };
            cancelButton.Click += (_, _) => Close();

            installButton.Text = "Install";
            installButton.Location = new Point(528, 158);
            installButton.Size = new Size(96, 32);
            installButton.Click += (_, _) => Install();

            statusLabel.AutoSize = false;
            statusLabel.Location = new Point(16, 138);
            statusLabel.Size = new Size(392, 58);

            Controls.AddRange(new Control[] { label, folderTextBox, browseButton, desktopShortcutCheckBox, statusLabel, cancelButton, installButton });
            AcceptButton = installButton;
            CancelButton = cancelButton;
        }

        private void BrowseForFolder()
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = "Choose install folder",
                SelectedPath = folderTextBox.Text
            };

            if (dialog.ShowDialog(this) == DialogResult.OK)
            {
                folderTextBox.Text = dialog.SelectedPath;
            }
        }

        private void Install()
        {
            try
            {
                installButton.Enabled = false;
                statusLabel.Text = "Installing...";
                Application.DoEvents();

                var installRoot = folderTextBox.Text.Trim();
                if (string.IsNullOrWhiteSpace(installRoot)) throw new InvalidOperationException("Install folder is required.");

                InstallTo(installRoot, desktopShortcutCheckBox.Checked);

                statusLabel.Text = "Installed.";
                var exe = Path.Combine(installRoot, AppExeName);
                var result = MessageBox.Show(
                    this,
                    "Arcadien Army Assembler installed successfully.\n\nInstalled app:\n" + exe + "\n\nLaunch it now?",
                    "Arcadien Army Assembler installed",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Information);

                if (result == DialogResult.Yes)
                {
                    Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = installRoot, UseShellExecute = true });
                }

                Close();
            }
            catch (Exception ex)
            {
                installButton.Enabled = true;
                statusLabel.Text = "Install failed.";
                MessageBox.Show(this, ex.Message, "Arcadien Army Assembler install failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    private static void InstallTo(string installRoot, bool createDesktopShortcut)
    {
        var marker = Path.Combine(installRoot, ".roster-builder-install");
        Directory.CreateDirectory(installRoot);

        var existingItems = Directory.EnumerateFileSystemEntries(installRoot).ToArray();
        var isExistingRosterBuilderInstall =
            File.Exists(marker) ||
            File.Exists(Path.Combine(installRoot, AppExeName)) ||
            File.Exists(Path.Combine(installRoot, LegacyAppExeName));

        if (existingItems.Length > 0 && !isExistingRosterBuilderInstall)
        {
            throw new InvalidOperationException(
                "The target folder already exists and is not marked as a Roster Builder install: " +
                installRoot +
                ". Choose another install folder or move the existing folder first.");
        }

        foreach (var item in AppItems)
        {
            var target = Path.Combine(installRoot, item);
            if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
            else if (File.Exists(target)) File.Delete(target);
        }

        using var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("roster-builder-app.zip")
            ?? throw new InvalidOperationException("Installer payload is missing.");
        using var archive = new ZipArchive(payload, ZipArchiveMode.Read);
        archive.ExtractToDirectory(installRoot, overwriteFiles: true);

        Directory.CreateDirectory(Path.Combine(installRoot, "user-data"));
        Directory.CreateDirectory(Path.Combine(installRoot, "rosters"));
        Directory.CreateDirectory(Path.Combine(installRoot, "exports"));
        File.WriteAllText(marker, "Roster Builder local install");

        var exe = Path.Combine(installRoot, AppExeName);
        if (!File.Exists(exe)) throw new FileNotFoundException("Installed app executable not found.", exe);

        WriteUninstaller(installRoot);
        if (createDesktopShortcut)
        {
            CreateShortcut(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"),
                exe,
                installRoot);
        }

        var startMenuFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
        Directory.CreateDirectory(startMenuFolder);
        CreateShortcut(Path.Combine(startMenuFolder, AppName + ".lnk"), exe, installRoot);
    }

    private static void WriteUninstaller(string installRoot)
    {
        var uninstallPs1 = Path.Combine(installRoot, "Uninstall Roster Builder.ps1");
        var uninstallCmd = Path.Combine(installRoot, "Uninstall Roster Builder.cmd");
        var ps1 = @"$ErrorActionPreference = ""Stop""
$appName = ""Arcadien Army Assembler""
$installRoot = Split-Path -Parent $PSCommandPath
$marker = Join-Path $installRoot "".roster-builder-install""
if (!(Test-Path -LiteralPath $marker)) {
  Write-Error ""Refusing to uninstall because the install marker is missing.""
  exit 1
}

$appItems = @(
  ""locales"",
  ""resources"",
  ""chrome_100_percent.pak"",
  ""chrome_200_percent.pak"",
  ""d3dcompiler_47.dll"",
  ""ffmpeg.dll"",
  ""icudtl.dat"",
  ""libEGL.dll"",
  ""libGLESv2.dll"",
  ""LICENSE.electron.txt"",
  ""LICENSES.chromium.html"",
  ""resources.pak"",
  ""Arcadien Army Assembler.exe"",
  ""Roster Builder.exe"",
  ""snapshot_blob.bin"",
  ""v8_context_snapshot.bin"",
  ""vk_swiftshader.dll"",
  ""vk_swiftshader_icd.json"",
  ""vulkan-1.dll""
)

foreach ($item in $appItems) {
  $target = Join-Path $installRoot $item
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}

$desktopShortcut = Join-Path ([Environment]::GetFolderPath(""Desktop"")) ""Arcadien Army Assembler.lnk""
$startMenuFolder = Join-Path ([Environment]::GetFolderPath(""Programs"")) $appName
Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $startMenuFolder -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""Arcadien Army Assembler app files removed. Local rosters, exports, and user-data were left in:""
Write-Host $installRoot
";
        File.WriteAllText(uninstallPs1, ps1);
        File.WriteAllText(uninstallCmd, "@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Uninstall Roster Builder.ps1\"\r\nif errorlevel 1 pause\r\n");
    }

    private static void CreateShortcut(string shortcutPath, string targetPath, string workingDirectory)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;
        dynamic shell = Activator.CreateInstance(shellType)!;
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath = targetPath;
        shortcut.WorkingDirectory = workingDirectory;
        shortcut.Save();
    }
}
`;

  fs.writeFileSync(path.join(INSTALLER_WORK, "RosterBuilderInstaller.csproj"), csproj, "utf8");
  fs.writeFileSync(path.join(INSTALLER_WORK, "Program.cs"), program, "utf8");
  fs.writeFileSync(
    path.join(INSTALLER_WORK, "NuGet.Config"),
    String.raw`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
  </packageSources>
</configuration>
`,
    "utf8"
  );
}

function publishInstaller() {
  fs.rmSync(INSTALLER_EXE, { force: true });
  for (const file of fs.readdirSync(RELEASE_DIR)) {
    if (file.startsWith("RosterBuilderInstaller.")) fs.rmSync(path.join(RELEASE_DIR, file), { force: true });
  }
  run("dotnet.exe", [
    "publish",
    path.join(INSTALLER_WORK, "RosterBuilderInstaller.csproj"),
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "true",
    "/p:PublishSingleFile=true",
    "/p:EnableCompressionInSingleFile=true",
    "/p:IncludeNativeLibrariesForSelfExtract=true",
    "/p:DebugType=none",
    "/p:DebugSymbols=false",
    `/p:RestoreConfigFile=${path.join(INSTALLER_WORK, "NuGet.Config")}`
  ]);

  const builtDir = path.join(
    INSTALLER_WORK,
    "bin",
    "Release",
    "net9.0-windows",
    "win-x64",
    "publish"
  );
  const built = path.join(
    builtDir,
    "RosterBuilderInstaller.exe"
  );
  if (!fs.existsSync(built)) throw new Error(`dotnet did not create ${built}`);
  fs.copyFileSync(built, INSTALLER_EXE);
}

function main() {
  assertUnpackedApp();
  fs.rmSync(INSTALLER_WORK, { recursive: true, force: true });
  fs.mkdirSync(INSTALLER_WORK, { recursive: true });
  prepareInstallerIcon();
  zipPayload();
  writeDotnetProject();
  publishInstaller();

  const stats = fs.statSync(INSTALLER_EXE);
  console.log(`Built ${INSTALLER_EXE}`);
  console.log(`Installer size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

if (require.main === module) main();
