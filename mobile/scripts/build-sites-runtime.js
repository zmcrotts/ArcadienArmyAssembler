"use strict";

const fs = require("fs");
const path = require("path");
const { main: buildMobileRuntime } = require("./build-user-runtime");

const ROOT = path.resolve(__dirname, "..");
const MOBILE_RUNTIME = path.join(ROOT, "dist-user");
const DIST = path.join(ROOT, "dist");
const CLIENT = path.join(DIST, "client");
const SERVER = path.join(DIST, "server");

function main() {
  buildMobileRuntime();
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(SERVER, { recursive: true });
  fs.cpSync(MOBILE_RUNTIME, CLIENT, { recursive: true });
  fs.writeFileSync(path.join(SERVER, "package.json"), '{"type":"module"}\n', "utf8");
  fs.writeFileSync(path.join(SERVER, "index.js"), `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") url.pathname = "/index.html";
    let response = await env.ASSETS.fetch(new Request(url, request));
    if (response.status === 404 && request.method === "GET" && request.headers.get("accept")?.includes("text/html")) {
      url.pathname = "/index.html";
      response = await env.ASSETS.fetch(new Request(url, request));
    }
    if (url.pathname === "/service-worker.js") {
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-cache, no-store, must-revalidate");
      headers.set("service-worker-allowed", "/");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  }
};
`, "utf8");
  console.log(`Built Sites package in ${DIST}`);
}

if (require.main === module) main();

module.exports = { main };
