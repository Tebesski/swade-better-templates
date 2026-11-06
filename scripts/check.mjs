import {readdir, readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
async function files(dir) { return (await Promise.all((await readdir(dir, {withFileTypes: true})).map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat(); }
let failed = false;
for (const file of [...await files("scripts"), ...await files("tests")].filter(f => f.endsWith(".mjs"))) {
  const result = spawnSync(process.execPath, ["--check", file], {encoding: "utf8"});
  if (result.status) { failed = true; console.error(result.stderr); }
}
for (const file of ["module.json", "lang/en.json", "package.json"]) JSON.parse(await readFile(file, "utf8"));
if (failed) process.exitCode = 1; else console.log("Module syntax and JSON checks passed.");
