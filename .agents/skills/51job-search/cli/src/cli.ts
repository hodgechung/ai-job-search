#!/usr/bin/env bun
import { main as runPortal, runEntry } from "../../../../../tools/china_portals/cli.js"
import { searchResult } from "./commands/search.js"
export const main = (args: string[]) => runPortal("51job", args, searchResult)
if (import.meta.main) {
  try { process.exitCode = await runEntry("51job", import.meta.url, searchResult) }
  catch { process.stderr.write(JSON.stringify({ code: "WORKER_ERROR", error: "Could not run the portal browser worker" }) + "\n"); process.exitCode = 1 }
}
