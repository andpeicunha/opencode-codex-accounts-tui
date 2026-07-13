import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const readJson = (path) => JSON.parse(readFileSync(resolve(path), "utf8"));
const pkg = readJson("package.json");
const installedPlugin = readJson("node_modules/@opencode-ai/plugin/package.json");
const installedOpenTui = readJson("node_modules/@opentui/solid/package.json");
const opencodeVersion = execFileSync("opencode", ["--version"], { encoding: "utf8" }).trim();

const expectedPlugin = pkg.dependencies["@opencode-ai/plugin"];
if (opencodeVersion !== expectedPlugin || installedPlugin.version !== expectedPlugin) {
  throw new Error(
    `OpenCode/plugin mismatch: opencode=${opencodeVersion}, expected=${expectedPlugin}, installed=${installedPlugin.version}`,
  );
}

const expectedOpenTui = pkg.dependencies["@opentui/solid"];
if (installedOpenTui.version !== expectedOpenTui) {
  throw new Error(
    `OpenTUI mismatch: expected=${expectedOpenTui}, installed=${installedOpenTui.version}`,
  );
}

console.log(`compat ok: opencode/plugin ${expectedPlugin}, opentui ${expectedOpenTui}`);
