"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const { ensureCrosshairIcon } = require("./write-crosshair-icon");
const { verifyUnpackedApp } = require("./build-electron-dir");
const { version: APP_VERSION } = require("../package.json");

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
  verifyUnpackedApp(UNPACKED_DIR);
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
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    private const string AppName = "Arcadien Army Assembler";
    private const string AppVersion = "${APP_VERSION}";
    private const string AppExeName = "Arcadien Army Assembler.exe";
    private const string LegacyAppExeName = "Roster Builder.exe";
    private const string RegistryKeyPath = @"Software\Arcadien Army Assembler";
    private const string UninstallRegistryKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Arcadien Army Assembler";

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
        private readonly Label instructionLabel = new();

        internal InstallForm()
        {
            Text = "Install Arcadien Army Assembler";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            ClientSize = new Size(640, 218);

            instructionLabel.Text = "Choose where Arcadien Army Assembler should be installed. Saves, exports, and app data will live in this folder too.";
            instructionLabel.AutoSize = false;
            instructionLabel.Location = new Point(14, 14);
            instructionLabel.Size = new Size(610, 38);

            var existingInstall = FindExistingInstall();
            var defaultInstall = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName);
            folderTextBox.Text = existingInstall ?? defaultInstall;
            if (existingInstall != null)
            {
                instructionLabel.Text = "Existing Arcadien Army Assembler installation found. It will be updated in place; saves, exports, and app data will be preserved.";
            }

            folderTextBox.Location = new Point(16, 64);
            folderTextBox.Size = new Size(496, 24);

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

            installButton.Text = existingInstall != null ? "Update" : "Install";
            installButton.Location = new Point(528, 158);
            installButton.Size = new Size(96, 32);
            installButton.Click += (_, _) => Install();

            statusLabel.AutoSize = false;
            statusLabel.Location = new Point(16, 138);
            statusLabel.Size = new Size(392, 58);

            Controls.AddRange(new Control[] { instructionLabel, folderTextBox, browseButton, desktopShortcutCheckBox, statusLabel, cancelButton, installButton });
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
                var existing = IsRosterBuilderInstall(dialog.SelectedPath);
                installButton.Text = existing ? "Update" : "Install";
                instructionLabel.Text = existing
                    ? "Existing Arcadien Army Assembler installation found. It will be updated in place; saves, exports, and app data will be preserved."
                    : "Choose where Arcadien Army Assembler should be installed. Saves, exports, and app data will live in this folder too.";
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

    private static bool IsRosterBuilderInstall(string? directory)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Directory.Exists(directory)) return false;
        return File.Exists(Path.Combine(directory, ".roster-builder-install"))
            || File.Exists(Path.Combine(directory, AppExeName))
            || File.Exists(Path.Combine(directory, LegacyAppExeName));
    }

    private static string? FindExistingInstall()
    {
        var candidates = new System.Collections.Generic.List<string?>();

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(RegistryKeyPath);
            candidates.Add(key?.GetValue("InstallLocation") as string);
        }
        catch { }

        foreach (var shortcut in ExistingShortcutPaths()) candidates.Add(ShortcutTargetDirectory(shortcut));
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), AppName));

        foreach (var candidate in candidates.Where(item => !string.IsNullOrWhiteSpace(item)).Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (IsRosterBuilderInstall(candidate)) return Path.GetFullPath(candidate!);
        }

        return null;
    }

    private static string[] ExistingShortcutPaths()
    {
        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var programs = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        return new[]
        {
            Path.Combine(desktop, AppName + ".lnk"),
            Path.Combine(desktop, "Roster Builder.lnk"),
            Path.Combine(programs, AppName, AppName + ".lnk"),
            Path.Combine(programs, "Roster Builder", "Roster Builder.lnk")
        };
    }

    private static string? ShortcutTargetDirectory(string shortcutPath)
    {
        if (!File.Exists(shortcutPath)) return null;
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return null;
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            string target = shortcut.TargetPath;
            return string.IsNullOrWhiteSpace(target) ? null : Path.GetDirectoryName(target);
        }
        catch { return null; }
    }

    private sealed class RegistryValueSnapshot
    {
        internal string Name { get; }
        internal object Value { get; }
        internal RegistryValueKind Kind { get; }

        internal RegistryValueSnapshot(string name, object value, RegistryValueKind kind)
        {
            Name = name;
            Value = value;
            Kind = kind;
        }
    }

    private sealed class RegistryKeySnapshot
    {
        internal bool Existed { get; }
        internal List<RegistryValueSnapshot> Values { get; }

        internal RegistryKeySnapshot(bool existed, List<RegistryValueSnapshot>? values = null)
        {
            Existed = existed;
            Values = values ?? new List<RegistryValueSnapshot>();
        }
    }

    private static RegistryKeySnapshot CaptureRegistryKey(string path)
    {
        using var key = Registry.CurrentUser.OpenSubKey(path);
        if (key == null) return new RegistryKeySnapshot(false);
        var values = new List<RegistryValueSnapshot>();
        foreach (var name in key.GetValueNames())
        {
            var value = key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
            if (value != null) values.Add(new RegistryValueSnapshot(name, value, key.GetValueKind(name)));
        }
        return new RegistryKeySnapshot(true, values);
    }

    private static void RestoreRegistryKey(string path, RegistryKeySnapshot snapshot)
    {
        Registry.CurrentUser.DeleteSubKeyTree(path, throwOnMissingSubKey: false);
        if (!snapshot.Existed) return;
        using var key = Registry.CurrentUser.CreateSubKey(path)
            ?? throw new InvalidOperationException("Could not restore installer registry metadata.");
        foreach (var value in snapshot.Values) key.SetValue(value.Name, value.Value, value.Kind);
    }

    private static byte[]? CaptureFile(string path)
    {
        return File.Exists(path) ? File.ReadAllBytes(path) : null;
    }

    private static void RestoreFile(string path, byte[]? contents)
    {
        if (contents == null)
        {
            if (File.Exists(path)) File.Delete(path);
            return;
        }
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, contents);
    }

    private static void DeleteDirectoryIfNewAndEmpty(string path, bool existed)
    {
        if (!existed && Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any())
            Directory.Delete(path);
    }

    private static void InstallTo(string installRoot, bool createDesktopShortcut)
    {
        installRoot = Path.GetFullPath(installRoot);
        var installRootExisted = Directory.Exists(installRoot);
        var marker = Path.Combine(installRoot, ".roster-builder-install");
        var parent = Directory.GetParent(installRoot)?.FullName
            ?? throw new InvalidOperationException("Install folder must have a parent folder.");
        Directory.CreateDirectory(parent);

        var existingItems = Directory.Exists(installRoot)
            ? Directory.EnumerateFileSystemEntries(installRoot).ToArray()
            : Array.Empty<string>();
        var isExistingRosterBuilderInstall = IsRosterBuilderInstall(installRoot);

        if (existingItems.Length > 0 && !isExistingRosterBuilderInstall)
        {
            throw new InvalidOperationException(
                "The target folder already exists and is not marked as a Roster Builder install: " +
                installRoot +
                ". Choose another install folder or move the existing folder first.");
        }

        var stagingRoot = Path.Combine(parent, "." + Path.GetFileName(installRoot) + ".installing-" + Guid.NewGuid().ToString("N"));
        var backupRoot = Path.Combine(parent, "." + Path.GetFileName(installRoot) + ".backup-" + Guid.NewGuid().ToString("N"));
        var installedItems = new List<string>();
        var backedUpItems = new List<string>();
        var transactionItems = AppItems.Concat(new[] { "Uninstall Roster Builder.ps1", "Uninstall Roster Builder.cmd" }).ToArray();
        var markerExisted = File.Exists(marker);
        var userDataFolder = Path.Combine(installRoot, "user-data");
        var rostersFolder = Path.Combine(installRoot, "rosters");
        var exportsFolder = Path.Combine(installRoot, "exports");
        var userDataFolderExisted = Directory.Exists(userDataFolder);
        var rostersFolderExisted = Directory.Exists(rostersFolder);
        var exportsFolderExisted = Directory.Exists(exportsFolder);
        var desktopShortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
        var startMenuFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName);
        var startMenuShortcut = Path.Combine(startMenuFolder, AppName + ".lnk");
        var startMenuFolderExisted = Directory.Exists(startMenuFolder);
        var desktopShortcutSnapshot = createDesktopShortcut ? CaptureFile(desktopShortcut) : null;
        var startMenuShortcutSnapshot = CaptureFile(startMenuShortcut);
        var registrySnapshot = CaptureRegistryKey(RegistryKeyPath);
        var uninstallRegistrySnapshot = CaptureRegistryKey(UninstallRegistryKeyPath);
        var completed = false;

        try
        {
            ExtractPayload(stagingRoot);
            ValidatePayload(stagingRoot);
            WriteUninstaller(stagingRoot);

            Directory.CreateDirectory(installRoot);
            Directory.CreateDirectory(backupRoot);
            foreach (var item in transactionItems)
            {
                var source = Path.Combine(stagingRoot, item);
                var target = Path.Combine(installRoot, item);
                var backup = Path.Combine(backupRoot, item);
                if (Directory.Exists(target) || File.Exists(target))
                {
                    MovePath(target, backup);
                    backedUpItems.Add(item);
                }
                MovePath(source, target);
                installedItems.Add(item);
            }

            ValidatePayload(installRoot);
            Directory.CreateDirectory(userDataFolder);
            Directory.CreateDirectory(rostersFolder);
            Directory.CreateDirectory(exportsFolder);
            File.WriteAllText(marker, "Arcadien Army Assembler local install");

            var exe = Path.Combine(installRoot, AppExeName);
            RegisterInstall(installRoot, exe);
            if (createDesktopShortcut)
            {
                CreateShortcut(desktopShortcut, exe, installRoot);
            }

            Directory.CreateDirectory(startMenuFolder);
            CreateShortcut(startMenuShortcut, exe, installRoot);
            completed = true;
        }
        catch (Exception installError)
        {
            try
            {
                foreach (var item in installedItems.AsEnumerable().Reverse()) DeletePath(Path.Combine(installRoot, item));
                foreach (var item in backedUpItems.AsEnumerable().Reverse()) MovePath(Path.Combine(backupRoot, item), Path.Combine(installRoot, item));
                if (!markerExisted && File.Exists(marker)) File.Delete(marker);
                RestoreRegistryKey(RegistryKeyPath, registrySnapshot);
                RestoreRegistryKey(UninstallRegistryKeyPath, uninstallRegistrySnapshot);
                if (createDesktopShortcut) RestoreFile(desktopShortcut, desktopShortcutSnapshot);
                RestoreFile(startMenuShortcut, startMenuShortcutSnapshot);
                DeleteDirectoryIfNewAndEmpty(startMenuFolder, startMenuFolderExisted);
                DeleteDirectoryIfNewAndEmpty(userDataFolder, userDataFolderExisted);
                DeleteDirectoryIfNewAndEmpty(rostersFolder, rostersFolderExisted);
                DeleteDirectoryIfNewAndEmpty(exportsFolder, exportsFolderExisted);
                DeleteDirectoryIfNewAndEmpty(installRoot, installRootExisted);
                DeletePath(backupRoot);
            }
            catch (Exception rollbackError)
            {
                throw new AggregateException(
                    "Installation failed and automatic rollback was incomplete. The preserved backup is: " + backupRoot,
                    installError,
                    rollbackError);
            }
            throw;
        }
        finally
        {
            TryDeletePath(stagingRoot);
            if (completed) TryDeletePath(backupRoot);
        }
    }

    private static void ExtractPayload(string stagingRoot)
    {
        Directory.CreateDirectory(stagingRoot);
        var stagingPrefix = Path.GetFullPath(stagingRoot) + Path.DirectorySeparatorChar;
        using var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("roster-builder-app.zip")
            ?? throw new InvalidOperationException("Installer payload is missing.");
        using var archive = new ZipArchive(payload, ZipArchiveMode.Read);
        foreach (var entry in archive.Entries)
        {
            var destination = Path.GetFullPath(Path.Combine(stagingRoot, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
            if (!destination.StartsWith(stagingPrefix, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Installer payload contains an unsafe path.");
            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destination);
                continue;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            entry.ExtractToFile(destination, overwrite: false);
        }
    }

    private static void ValidatePayload(string root)
    {
        foreach (var item in AppItems)
        {
            var target = Path.Combine(root, item);
            if (!Directory.Exists(target) && !File.Exists(target))
                throw new InvalidOperationException("Installer payload is incomplete: " + item);
        }
        foreach (var file in new[] { AppExeName, "resources.pak", Path.Combine("resources", "app.asar") })
        {
            var target = Path.Combine(root, file);
            if (!File.Exists(target) || new FileInfo(target).Length == 0)
                throw new InvalidOperationException("Installer payload contains an empty required file: " + file);
        }
    }

    private static void MovePath(string source, string destination)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        if (Directory.Exists(source)) Directory.Move(source, destination);
        else if (File.Exists(source)) File.Move(source, destination);
        else throw new FileNotFoundException("Installer item is missing.", source);
    }

    private static void DeletePath(string target)
    {
        if (Directory.Exists(target)) Directory.Delete(target, recursive: true);
        else if (File.Exists(target)) File.Delete(target);
    }

    private static void TryDeletePath(string target)
    {
        try { DeletePath(target); }
        catch { }
    }

    private static void RegisterInstall(string installRoot, string exe)
    {
        using (var key = Registry.CurrentUser.CreateSubKey(RegistryKeyPath))
        {
            key.SetValue("InstallLocation", installRoot, RegistryValueKind.String);
        }
        using (var key = Registry.CurrentUser.CreateSubKey(UninstallRegistryKeyPath))
        {
            key.SetValue("DisplayName", AppName, RegistryValueKind.String);
            key.SetValue("DisplayVersion", AppVersion, RegistryValueKind.String);
            key.SetValue("Publisher", "zmcrotts", RegistryValueKind.String);
            key.SetValue("InstallLocation", installRoot, RegistryValueKind.String);
            key.SetValue("DisplayIcon", exe, RegistryValueKind.String);
            key.SetValue("UninstallString", "\"" + Path.Combine(installRoot, "Uninstall Roster Builder.cmd") + "\"", RegistryValueKind.String);
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
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

$registryKey = ""HKCU:\Software\Arcadien Army Assembler""
$registeredLocation = (Get-ItemProperty -LiteralPath $registryKey -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation
if ($registeredLocation -and ([IO.Path]::GetFullPath($registeredLocation) -eq [IO.Path]::GetFullPath($installRoot))) {
  Remove-Item -LiteralPath $registryKey -Recurse -Force -ErrorAction SilentlyContinue
}
$uninstallRegistryKey = ""HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Arcadien Army Assembler""
$registeredUninstallLocation = (Get-ItemProperty -LiteralPath $uninstallRegistryKey -Name InstallLocation -ErrorAction SilentlyContinue).InstallLocation
if ($registeredUninstallLocation -and ([IO.Path]::GetFullPath($registeredUninstallLocation) -eq [IO.Path]::GetFullPath($installRoot))) {
  Remove-Item -LiteralPath $uninstallRegistryKey -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ""Arcadien Army Assembler app files removed. Local rosters, exports, and user-data were left in:""
Write-Host $installRoot
";
        File.WriteAllText(uninstallPs1, ps1);
        File.WriteAllText(uninstallCmd, "@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0Uninstall Roster Builder.ps1\"\r\nif errorlevel 1 pause\r\n");
    }

    private static void CreateShortcut(string shortcutPath, string targetPath, string workingDirectory)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetPath;
            shortcut.WorkingDirectory = workingDirectory;
            shortcut.Save();
        }
        catch { }
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
  if (fs.statSync(built).size === 0) throw new Error(`dotnet created an empty installer: ${built}`);
  const replacement = `${INSTALLER_EXE}.new`;
  const previous = `${INSTALLER_EXE}.previous`;
  fs.rmSync(replacement, { force: true });
  fs.rmSync(previous, { force: true });
  fs.copyFileSync(built, replacement);
  try {
    if (fs.existsSync(INSTALLER_EXE)) fs.renameSync(INSTALLER_EXE, previous);
    fs.renameSync(replacement, INSTALLER_EXE);
    fs.rmSync(previous, { force: true });
  } catch (error) {
    fs.rmSync(replacement, { force: true });
    if (!fs.existsSync(INSTALLER_EXE) && fs.existsSync(previous)) fs.renameSync(previous, INSTALLER_EXE);
    throw error;
  }
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
