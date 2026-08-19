"use strict";

(() => {

const IMPORT_SCHEME = "arcadien:";
const IMPORT_HOST = "import";
const MAX_QR_SHARE_CODE_LENGTH = 2800;

function buildImportUrl(code) {
  const normalized = String(code || "").trim();
  if (!normalized) throw new Error("The roster share code is empty.");
  if (normalized.length > MAX_QR_SHARE_CODE_LENGTH) {
    throw new Error(`This roster's share code is too large for a reliable QR code (${normalized.length} characters). Use Copy Share Code instead.`);
  }
  return `${IMPORT_SCHEME}//${IMPORT_HOST}?code=${encodeURIComponent(normalized)}`;
}

function parseImportUrl(value) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error("That is not an Arcadien roster link.");
  }
  if (url.protocol !== IMPORT_SCHEME || url.hostname.toLowerCase() !== IMPORT_HOST || (url.pathname && url.pathname !== "/")) {
    throw new Error("That is not an Arcadien roster link.");
  }
  const code = String(url.searchParams.get("code") || "").trim();
  if (!code) throw new Error("The Arcadien roster link does not contain a share code.");
  if (code.length > MAX_QR_SHARE_CODE_LENGTH) throw new Error("The Arcadien roster link is too large.");
  return code;
}

function createQrSvg(importUrl, options = {}) {
  if (typeof qrcode !== "function") throw new Error("The QR generator is unavailable.");
  const qr = qrcode(0, options.errorCorrection || "M");
  qr.addData(String(importUrl || ""), "Byte");
  try {
    qr.make();
  } catch (error) {
    if (/overflow/i.test(String(error?.message || error))) {
      throw new Error("This roster is too large for a reliable QR code. Use Copy Share Code instead.");
    }
    throw error;
  }
  return qr.createSvgTag({
    cellSize: Number(options.cellSize || 5),
    margin: Number(options.margin || 4),
    scalable: true
  }).replace("<svg ", '<svg shape-rendering="crispEdges" ');
}

const api = Object.freeze({
  IMPORT_SCHEME,
  IMPORT_HOST,
  MAX_QR_SHARE_CODE_LENGTH,
  buildImportUrl,
  parseImportUrl,
  createQrSvg
});

if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.RosterQr = api;
})();
