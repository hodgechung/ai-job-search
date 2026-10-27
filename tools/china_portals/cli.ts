import { mkdir, writeFile, rename } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { join } from "node:path"
import { PortalError, isPortalError, PORTALS, cityCode, jobAddress, formatJob, type Portal, type Job } from "./model.js"
import { Store, DEFAULT_DATA_DIR } from "./store.js"
import { openNativeLogin } from "./native.js"
import { publicZhaopinDetail, publicZhaopinSearch } from "./zhaopin.js"
import { withBrowser, type Options } from "./browser.js"

type Flags = Record<string, string | boolean>
export function parse(args: string[]) {
  const [command, ...rest] = args
  if (!command || args.includes("--help") || args.includes("-h")) return { command: "help", flags: {} as Flags, positional: [] as string[] }
  if (!["open", "login", "status", "search", "detail"].includes(command)) throw new PortalError("BAD_CMD", "Use open, login, status, search, or detail; see --help")
  const common = ["format", "timeout", "browser", "data-dir", "no-wait"]
  const allowed = [...common, ...(command === "search" ? ["query", "location", "limit", "page"] : command === "detail" ? ["refresh", "cached-only"] : [])]
  const booleans = ["no-wait", "refresh", "cached-only"]
  const aliases: Record<string, string> = { q: "query", l: "location", n: "limit" }
  const flags: Flags = {}, positional: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith("-")) { positional.push(arg); continue }
    const raw = arg.replace(/^-+/, ""), key = aliases[raw] ?? raw
    if (!allowed.includes(key)) throw new PortalError("UNKNOWN_FLAG", "Unsupported flag --" + key)
    if (flags[key] !== undefined) throw new PortalError("BAD_ARG", "Duplicate flag --" + key)
    if (booleans.includes(key)) { flags[key] = true; continue }
    const value = rest[++i]
    if (!value || value.startsWith("-")) throw new PortalError("BAD_ARG", "--" + key + " requires a value")
    flags[key] = value
  }
  if (positional.length !== (command === "detail" ? 1 : 0)) throw new PortalError("BAD_ARG", command === "detail" ? "detail requires one ID or URL" : "Unexpected positional argument")
  return { command, flags, positional }
}
function integer(value: string | boolean | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined ? fallback : typeof value === "string" && value.trim() ? Number(value) : NaN
  if (!Number.isInteger(n) || n < min || n > max) throw new PortalError("BAD_ARG", `Integer must be in ${min}–${max}`)
  return n
}
function output(value: unknown) { process.stdout.write(JSON.stringify(value, null, 2) + "\n") }
export async function main(portal: Portal, args: string[], project: (job: Job) => Job): Promise<number> {
  try {
    const { command, flags, positional } = parse(args)
    if (command === "help") {
      process.stdout.write(`${PORTALS[portal].label} — read-only local-browser portal\nCommands: open | login | status | search -q <岗位> -l <城市> | detail <id|url>\n` +
        "Flags: --limit/-n 1..20 (default 3), --page 1, --format json|table|plain\n" +
        "detail: --cached-only | --refresh; table is search-only\n" +
        "--timeout 10..60 (page-load seconds, default 20), --browser chrome|chromium, --data-dir <path>\n" +
        "--no-wait is accepted for batch calls; authentication gates always return immediately.\n" +
        "open starts ordinary Chrome; public jobs do not require login. Use login only when the site requests it.\n" +
        "No publication-age filter. Unknown dates stay null. No messages, applications or uploads.\n")
      return 0
    }
    const format = String(flags.format ?? "json")
    if (!(command === "search" ? ["json", "table", "plain"] : ["json", "plain"]).includes(format)) throw new PortalError("BAD_ARG", "Unsupported output format")
    const browser = String(flags.browser ?? "chrome")
    if (browser !== "chrome" && browser !== "chromium") throw new PortalError("BAD_ARG", "--browser must be chrome|chromium")
    const options: Options = { browser, timeout: integer(flags.timeout, 20, 10, 60) }
    const store = new Store(portal, typeof flags["data-dir"] === "string" ? flags["data-dir"] : undefined)
    if (command === "open" || command === "login") {
      const result = await openNativeLogin(store, browser)
      const instruction = command === "open"
        ? `专用浏览器已就绪；公开岗位可直接搜索，无需预先登录。需要验证时由用户操作。不会自动刷新页面。`
        : `手动在专用窗口打开 ${PORTALS[portal].home}；仅在网站要求时完成登录或验证。不会自动刷新页面。`
      if (format === "plain") process.stdout.write(instruction + "\n")
      else output({ ...result, ...(command === "open" ? { status: "browser_ready" } : {}), instruction })
      return 0
    }
    if (command === "status") {
      await withBrowser(store, options, false, async client => {
        await client.gate()
        const result = { status: "no_gate_detected", authenticated: null, instruction: "This is not proof of authentication; public listings may work without login" }
        if (format === "plain") process.stdout.write(result.status + "\n"); else output(result)
      })
      return 0
    }
    if (command === "detail") {
      if (flags.refresh && flags["cached-only"]) throw new PortalError("BAD_ARG", "--refresh conflicts with --cached-only")
      const { id } = jobAddress(portal, positional[0])
      const cached = flags.refresh ? null : await store.get(id)
      if (!cached && flags["cached-only"]) throw new PortalError("CACHE_MISS", "No complete snapshot; capture this posting from the parent workflow first")
      const job = cached ?? (portal === "zhaopin" ? await publicZhaopinDetail(positional[0], options.timeout)
        : await withBrowser(store, options, true, client => client.detail(positional[0], undefined, !!flags.refresh)))
      if (!cached && portal === "zhaopin") await store.put(job)
      if (format === "plain") process.stdout.write(formatJob(job) + "\n")
      else output({ ...job, source: cached ? "cache" : portal === "zhaopin" ? "public_html" : "browser" })
      return 0
    }
    const query = String(flags.query ?? "").trim(), city = String(flags.location ?? "").trim().replace(/市$/, "")
    if (!query || !city) throw new PortalError("BAD_ARG", "search requires --query/-q and --location/-l")
    cityCode(portal, city); integer(flags.page, 1, 1, 1)
    const limit = integer(flags.limit, 3, 1, 20)
    const jobs = (portal === "zhaopin" ? await publicZhaopinSearch(store, query, city, limit, options.timeout)
      : await withBrowser(store, options, true, client => client.search(query, city, limit))).map(project)
    if (format === "plain") process.stdout.write(jobs.map(formatJob).join("\n\n") + "\n")
    else if (format === "table") process.stdout.write(["ID\tTITLE\tCOMPANY\tLOCATION\tSALARY", ...jobs.map(job =>
      [job.id, job.title, job.company, job.location, job.salary].map(v => String(v ?? "—").replace(/[\r\n\t]/g, " ")).join("\t"))].join("\n") + "\n")
    else output({ meta: { count: jobs.length, page: 1, portal, query, city, source: portal === "zhaopin" ? "public_html" : "browser", snapshot: true, dateFilterSupported: false }, results: jobs })
    return 0
  } catch (error) {
    const known = isPortalError(error)
    const message = known ? error.message : "Browser operation failed: " + String(error instanceof Error ? error.message : error)
      .replace(/https?:\/\/[^\s]+/g, "<url>").replace(/\u001b\[[0-9;]*m/g, "").slice(0, 250)
    process.stderr.write(JSON.stringify({ error: message, code: known ? error.code : "BROWSER_ERROR" }) + "\n")
    return 1
  }
}
export async function runEntry(portal: Portal, entryUrl: string, project: (job: Job) => Job): Promise<number> {
  const args = process.argv.slice(2)
  if ((portal === "zhaopin" && ["search", "detail"].includes(args[0])) || !process.versions.bun || args.includes("--cached-only") || args.includes("--help") || args.includes("-h")) return main(portal, args, project)
  const node = Bun.which("node")
  if (!node) { process.stderr.write(JSON.stringify({ error: "Install Node.js 20+ for Playwright CDP", code: "NODE_REQUIRED" }) + "\n"); return 1 }
  const directory = fileURLToPath(new URL("../node_modules/.cache/china-portals/", entryUrl))
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const build = await Bun.build({ entrypoints: [fileURLToPath(entryUrl)], target: "node", format: "esm", packages: "external",
    define: { CHINA_SOURCE_DATA_DIR: JSON.stringify(DEFAULT_DATA_DIR), "import.meta.main": "false" } })
  if (!build.success) throw new PortalError("BUILD_FAILED", "Could not build Node browser worker")
  const path = join(directory, "worker.mjs"), temporary = path + "." + process.pid + ".tmp"
  await writeFile(temporary, await build.outputs[0].text(), { mode: 0o600 }); await rename(temporary, path)
  const child = Bun.spawn([node, "--input-type=module", "-e", "const {main}=await import(process.argv[1]);process.exitCode=await main(process.argv.slice(2));", pathToFileURL(path).href, ...args],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  return child.exited
}
