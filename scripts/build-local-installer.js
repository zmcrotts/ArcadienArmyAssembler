"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");
const UNPACKED_DIR = path.join(RELEASE_DIR, "win-unpacked");
const INSTALLER_WORK = path.join(os.tmpdir(), "RosterBuilderLocalInstaller");
const PAYLOAD_ZIP = path.join(INSTALLER_WORK, "roster-builder-app.zip");
const INSTALLER_EXE = path.join(RELEASE_DIR, "Roster Builder Local Setup.exe");
const INSTALLER_SUPPORT_FILES = [
  "RosterBuilderInstaller.dll",
  "RosterBuilderInstaller.deps.json",
  "RosterBuilderInstaller.runtimeconfig.json"
];

function assertUnpackedApp() {
  const exe = path.join(UNPACKED_DIR, "Roster Builder.exe");
  if (!fs.existsSync(exe)) {
    throw new Error("Missing release/win-unpacked/Roster Builder.exe. Run electron-builder --win dir first.");
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

function writeDotnetProject() {
  const csproj = String.raw`<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net9.0-windows</TargetFramework>
    <UseWindowsForms>true</UseWindowsForms>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <RuntimeIdentifier>win-x64</RuntimeIdentifier>
    <SelfContained>false</SelfContained>
    <DebugType>none</DebugType>
    <DebugSymbols>false</DebugSymbols>
  </PropertyGroup>
  <ItemGroup>
    <EmbeddedResource Include="roster-builder-app.zip" LogicalName="roster-builder-app.zip" />
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
    private const string AppName = "Roster Builder";

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
        "Roster Builder.exe",
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
        private readonly Button installButton = new();
        private readonly Label statusLabel = new();

        internal InstallForm()
        {
            Text = "Install Roster Builder";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(610, 170);

            var label = new Label
            {
                Text = "Choose a parent folder. Roster Builder will be installed into a Roster Builder folder inside it, with saves kept there too.",
                AutoSize = false,
                Location = new Point(14, 14),
                Size = new Size(580, 38)
            };

            folderTextBox.Location = new Point(16, 64);
            folderTextBox.Size = new Size(468, 24);
            folderTextBox.Text = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            var browseButton = new Button
            {
                Text = "Browse...",
                Location = new Point(500, 62),
                Size = new Size(90, 28)
            };
            browseButton.Click += (_, _) => BrowseForFolder();

            var cancelButton = new Button
            {
                Text = "Cancel",
                Location = new Point(396, 112),
                Size = new Size(92, 30),
                DialogResult = DialogResult.Cancel
            };
            cancelButton.Click += (_, _) => Close();

            installButton.Text = "Install";
            installButton.Location = new Point(500, 112);
            installButton.Size = new Size(90, 30);
            installButton.Click += (_, _) => Install();

            statusLabel.AutoSize = false;
            statusLabel.Location = new Point(16, 106);
            statusLabel.Size = new Size(360, 42);

            Controls.AddRange(new Control[] { label, folderTextBox, browseButton, statusLabel, cancelButton, installButton });
            AcceptButton = installButton;
            CancelButton = cancelButton;
        }

        private void BrowseForFolder()
        {
            using var dialog = new FolderBrowserDialog
            {
                Description = "Choose parent install folder",
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

                var parent = folderTextBox.Text.Trim();
                if (string.IsNullOrWhiteSpace(parent)) throw new InvalidOperationException("Install folder is required.");

                var installRoot = Path.Combine(parent, AppName);
                InstallTo(installRoot);

                statusLabel.Text = "Installed.";
                var exe = Path.Combine(installRoot, "Roster Builder.exe");
                Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = installRoot, UseShellExecute = true });
                Close();
            }
            catch (Exception ex)
            {
                installButton.Enabled = true;
                statusLabel.Text = "Install failed.";
                MessageBox.Show(this, ex.Message, "Roster Builder install failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    private static void InstallTo(string installRoot)
    {
        var marker = Path.Combine(installRoot, ".roster-builder-install");
        Directory.CreateDirectory(installRoot);

        var existingItems = Directory.EnumerateFileSystemEntries(installRoot).ToArray();
        var isExistingRosterBuilderInstall =
            File.Exists(marker) || File.Exists(Path.Combine(installRoot, "Roster Builder.exe"));

        if (existingItems.Length > 0 && !isExistingRosterBuilderInstall)
        {
            throw new InvalidOperationException(
                "The target folder already exists and is not marked as a Roster Builder install: " +
                installRoot +
                ". Choose another parent folder or move the existing folder first.");
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

        var exe = Path.Combine(installRoot, "Roster Builder.exe");
        if (!File.Exists(exe)) throw new FileNotFoundException("Installed app executable not found.", exe);

        WriteUninstaller(installRoot);
        CreateShortcut(
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Roster Builder.lnk"),
            exe,
            installRoot);

        var startMenuFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
        Directory.CreateDirectory(startMenuFolder);
        CreateShortcut(Path.Combine(startMenuFolder, "Roster Builder.lnk"), exe, installRoot);
    }

    private static void WriteUninstaller(string installRoot)
    {
        var uninstallPs1 = Path.Combine(installRoot, "Uninstall Roster Builder.ps1");
        var uninstallCmd = Path.Combine(installRoot, "Uninstall Roster Builder.cmd");
        var ps1 = @"$ErrorActionPreference = ""Stop""
$appName = ""Roster Builder""
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

$desktopShortcut = Join-Path ([Environment]::GetFolderPath(""Desktop"")) ""Roster Builder.lnk""
$startMenuFolder = Join-Path ([Environment]::GetFolderPath(""Programs"")) $appName
Remove-Item -LiteralPath $desktopShortcut -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $startMenuFolder -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""Roster Builder app files removed. Local rosters, exports, and user-data were left in:""
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
    <clear />
  </packageSources>
</configuration>
`,
    "utf8"
  );
}

function publishInstaller() {
  fs.rmSync(INSTALLER_EXE, { force: true });
  for (const file of INSTALLER_SUPPORT_FILES) fs.rmSync(path.join(RELEASE_DIR, file), { force: true });
  run("dotnet.exe", [
    "build",
    path.join(INSTALLER_WORK, "RosterBuilderInstaller.csproj"),
    "-c",
    "Release",
    "-r",
    "win-x64",
    "--self-contained",
    "false",
    "/p:DebugType=none",
    "/p:DebugSymbols=false",
    `/p:RestoreConfigFile=${path.join(INSTALLER_WORK, "NuGet.Config")}`
  ]);

  const builtDir = path.join(
    INSTALLER_WORK,
    "bin",
    "Release",
    "net9.0-windows",
    "win-x64"
  );
  const built = path.join(
    builtDir,
    "RosterBuilderInstaller.exe"
  );
  if (!fs.existsSync(built)) throw new Error(`dotnet did not create ${built}`);
  fs.copyFileSync(built, INSTALLER_EXE);
  for (const file of INSTALLER_SUPPORT_FILES) {
    const source = path.join(builtDir, file);
    if (!fs.existsSync(source)) throw new Error(`dotnet did not create ${source}`);
    fs.copyFileSync(source, path.join(RELEASE_DIR, file));
  }
}

function main() {
  assertUnpackedApp();
  fs.rmSync(INSTALLER_WORK, { recursive: true, force: true });
  fs.mkdirSync(INSTALLER_WORK, { recursive: true });
  zipPayload();
  writeDotnetProject();
  publishInstaller();

  const stats = fs.statSync(INSTALLER_EXE);
  console.log(`Built ${INSTALLER_EXE}`);
  console.log(`Installer size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  for (const file of INSTALLER_SUPPORT_FILES) {
    const supportPath = path.join(RELEASE_DIR, file);
    const supportStats = fs.statSync(supportPath);
    console.log(`Built ${supportPath} (${(supportStats.size / 1024 / 1024).toFixed(2)} MB)`);
  }
}

if (require.main === module) main();
