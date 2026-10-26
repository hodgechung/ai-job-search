import { mkdir, rename, writeFile } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join } from "node:path"
import { BossError } from "./helpers.js"
import { DEFAULT_DATA_DIR } from "./store.js"

/** Keep the portable Bun command while running Playwright's CDP transport in Node. */
export async function runNodeCLI(args: string[]): Promise<number> {
  const node = Bun.which("node")
  if (!node) throw new BossError("NODE_REQUIRED", "Install Node.js 20+ for Chrome connections; Bun remains the CLI entry point")
  const dir = fileURLToPath(new URL("../node_modules/.cache/boss-search/", import.meta.url))
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const result = await Bun.build({
    entrypoints: [fileURLToPath(new URL("./cli.ts", import.meta.url))],
    target: "node", format: "esm", packages: "external",
    define: { BOSS_SOURCE_DATA_DIR: JSON.stringify(DEFAULT_DATA_DIR), "import.meta.main": "false" },
  })
  if (!result.success) throw new BossError("BUILD_FAILED", "Could not build Node browser worker")
  const path = join(dir, "worker.mjs")
  const temp = path + "." + process.pid + ".tmp"
  await writeFile(temp, await result.outputs[0].text(), { mode: 0o600 })
  await rename(temp, path)
  const runner = 'const {main}=await import(process.argv[1]); process.exitCode=await main(process.argv.slice(2));'
  const child = Bun.spawn([node, "--input-type=module", "-e", runner, pathToFileURL(path).href, ...args], {
    stdin: "inherit", stdout: "inherit", stderr: "inherit",
  })
  return child.exited
}
