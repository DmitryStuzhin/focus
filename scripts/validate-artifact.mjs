import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
JSON.parse(manifest);

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

const app = workerModule.default;
const base = "https://focus.example";
const index = await app.fetch(new Request(base + "/"), {});
assert.equal(index.status, 200);
assert.equal(index.headers.get("x-content-type-options"), "nosniff");
assert.equal(index.headers.get("referrer-policy"), "same-origin");
assert.match(index.headers.get("content-security-policy"), /script-src 'self';/);
assert.match(index.headers.get("content-security-policy"), /frame-ancestors 'self'/);
const preview = await app.fetch(new Request(base + "/preview.html"), {});
assert.match(preview.headers.get("content-security-policy"), /^sandbox allow-scripts;/);
assert.equal(preview.headers.get("referrer-policy"), "no-referrer");
const anonymous = await app.fetch(new Request(base + "/api/chat", { method: "POST" }), {});
assert.equal(anonymous.status, 401);

console.log("Artifact is valid ESM and exports default.fetch");
