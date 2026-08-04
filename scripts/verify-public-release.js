"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "mobile", "public-release.json"), "utf8"));
const desktopPackage = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const mobilePackage = JSON.parse(fs.readFileSync(path.join(ROOT, "mobile", "package.json"), "utf8"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifyMetadata() {
  assert(manifest.windows.version === desktopPackage.version, "Public Windows version does not match package.json.");
  assert(manifest.android.version === mobilePackage.version, "Public Android version does not match mobile/package.json.");
  assert(manifest.ios.version === mobilePackage.version, "Public iOS version does not match mobile/package.json.");
  for (const [platform, item] of Object.entries(manifest)) {
    assert(/^[A-F0-9]{64}$/.test(item.sha256), `${platform} public SHA-256 is invalid.`);
    assert(String(item.asset || "").length > 0, `${platform} public asset name is missing.`);
  }
}

function localArtifact(platform) {
  const version = manifest[platform].version;
  const names = {
    windows: "Arcadien Army Assembler Setup.exe",
    android: `Arcadien Army Assembler Android ${version}.apk`,
    ios: `Arcadien Army Assembler iOS Web App ${version}.zip`
  };
  return path.join(ROOT, "release", names[platform]);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

function verifyLocal() {
  for (const platform of Object.keys(manifest)) {
    const filePath = localArtifact(platform);
    assert(fs.existsSync(filePath), `Local ${platform} release artifact is missing: ${filePath}`);
    assert(sha256(filePath) === manifest[platform].sha256, `Local ${platform} artifact does not match the public SHA-256.`);
  }
}

async function verifyRemote() {
  const response = await fetch("https://api.github.com/repos/zmcrotts/ArcadienArmyAssembler/releases/latest", {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "arcadien-public-release-verifier",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
    }
  });
  assert(response.ok, `Could not read the latest GitHub release (${response.status}).`);
  const release = await response.json();
  for (const [platform, expected] of Object.entries(manifest)) {
    const asset = (release.assets || []).find(item => item.name === expected.asset);
    assert(asset, `Latest GitHub release is missing ${expected.asset}.`);
    assert(String(asset.digest || "").toLowerCase() === `sha256:${expected.sha256.toLowerCase()}`,
      `Latest GitHub ${platform} asset does not match mobile/public-release.json.`);
  }
}

async function main() {
  verifyMetadata();
  if (process.argv.includes("--local")) verifyLocal();
  if (process.argv.includes("--remote")) await verifyRemote();
  console.log("Public release metadata: OK");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
