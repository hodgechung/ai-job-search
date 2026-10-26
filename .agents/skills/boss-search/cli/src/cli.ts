#!/usr/bin/env bun
import { BossError, isBossError, cityCode, formatDetail } from "./helpers.js"
import { renderSearch } from "./commands/search.js"
import { getDetail } from "./commands/detail.js"
import { openNativeLogin } from "./native.js"
import { Store } from "./store.js"
import { withBrowser, type BrowserOptions } from "./browser.js"
const HELP = [
  "boss-search — BOSS直聘只读采集（原型；需要本地可见浏览器）",
  "Commands: login | status | search -q <岗位> -l <城市> | detail <id|url>",
  "login: 打开独立普通 Chrome，手动登录，命令立即返回。status: 只读检查当前页面。",
  "Flags:",
  "  --page <n>                  第一版仅支持 --page 1",
  "  --limit/-n <n>              最多 20 条，默认 10",
  "  --format json|plain|table    默认 json；detail/login/status 不支持 table",
  "  --refresh                   detail 强制重新访问网站",
  "  --cached-only               detail 只读缓存，不启动浏览器",
  "  --no-wait                   登录失效或安全验证时立即返回错误",
  "  --timeout <seconds>         搜索/详情的验证等待 10–600 秒；login 立即返回",
  "  --browser chrome|chromium   默认使用已安装的 Google Chrome",
  "  --data-dir <path>           私密存储目录，默认 job_scraper/boss/",
  "  --help/-h",
  "城市：北京、上海、广州、深圳、杭州、成都、武汉、南京、苏州、西安、天津、重庆、全国，",
  "或网站的 9 位城市编码。没有发布日期过滤；未知 date 返回 null，不使用刷新时间。",
  "进度和登录提示写 stderr；stdout 只含结果。不会发消息、上传或投递简历。", ""
].join("\n")
type Flags = Record<string, string | boolean>
const COMMON = ["format", "no-wait", "timeout", "browser", "data-dir"]
const KNOWN: Record<string, string[]> = {
  login: COMMON, status: COMMON, search: [...COMMON, "query", "location", "page", "limit"],
  detail: [...COMMON, "refresh", "cached-only"],
}
const BOOLS = new Set(["no-wait", "refresh", "cached-only"])
function parse(argv: string[]): { command: string; positional: string[]; flags: Flags } {
  const command = argv.shift() ?? ""
  if (command === "--help" || command === "-h" || argv.includes("--help") || argv.includes("-h")) return { command: "help", positional: [], flags: {} }
  if (!Object.hasOwn(KNOWN, command)) throw new BossError("BAD_CMD", "Use login, status, search or detail; see --help")
  const flags: Flags = {}, positional: string[] = []
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("-")) { positional.push(arg); continue }
    const key = alias[arg.replace(/^-+/, "")] ?? arg.replace(/^-+/, "")
    if (!KNOWN[command].includes(key)) throw new BossError("UNKNOWN_FLAG", "Unsupported flag --" + key)
    if (flags[key] !== undefined) throw new BossError("BAD_ARG", "Duplicate flag --" + key)
    if (BOOLS.has(key)) { flags[key] = true; continue }
    const value = argv[++i]
    if (!value || value.startsWith("-")) throw new BossError("BAD_ARG", "--" + key + " requires a value")
    flags[key] = value
  }
  return { command, positional, flags }
}
function integer(value: string | boolean | undefined, fallback: number, max: number, min = 1): number {
  if (value === undefined) return fallback
  const n = typeof value === "string" && value.trim() ? Number(value) : NaN
  if (!Number.isInteger(n) || n < min || n > max) throw new BossError("BAD_ARG", "Integer must be in " + min + "–" + max)
  return n
}
function output(value: unknown): void { process.stdout.write(JSON.stringify(value, null, 2) + "\n") }
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const { command, positional, flags } = parse([...argv])
    if (command === "help") { process.stdout.write(HELP); return 0 }
    if (positional.length !== (command === "detail" ? 1 : 0)) throw new BossError("BAD_ARG", command === "detail" ? "detail requires one id|url" : "Unexpected positional argument")
    const format = String(flags.format ?? "json")
    if (!(command === "search" ? ["json", "plain", "table"] : ["json", "plain"]).includes(format)) throw new BossError("BAD_ARG", "Unsupported output format")
    const browser = String(flags.browser ?? "chrome")
    if (browser !== "chrome" && browser !== "chromium") throw new BossError("BAD_ARG", "--browser must be chrome|chromium")
    const options: BrowserOptions = { wait: !flags["no-wait"] && command !== "status", timeout: integer(flags.timeout, 300, 600, 10), browser }
    const store = new Store(typeof flags["data-dir"] === "string" ? flags["data-dir"] : undefined)
    if (command === "detail") {
      const { job, source } = await getDetail(store, options, positional[0], !!flags.refresh, !!flags["cached-only"])
      if (format === "plain") process.stdout.write(formatDetail(job) + "\n")
      else output({ ...job, source })
      return 0
    }
    const query = typeof flags.query === "string" ? flags.query.trim() : ""
    const city = typeof flags.location === "string" ? flags.location.trim() : ""
    const page = integer(flags.page, 1, 1), limit = integer(flags.limit, 10, 20)
    if (command === "search") {
      if (!query || !city) throw new BossError("BAD_ARG", "search requires --query/-q and --location/-l")
      cityCode(city)
    }
    if (command === "login") {
      const result = await openNativeLogin(store, browser)
      if (format === "plain") process.stdout.write((result.reused ? "请使用已打开的专用 Chrome。" : "已打开专用普通 Chrome。") + "手动完成登录后运行 status；程序未连接或操作页面。\n")
      else output({ ...result, instruction: "手动完成登录后运行 status；login 不代表已登录，窗口不会被程序关闭。" })
      return 0
    }
    await withBrowser(store, options, async client => {
      if (command === "status") {
        const state = await client.state()
        if (format === "plain") process.stdout.write(state + "\n")
        else output({ status: state, authenticated: state === "authenticated" })
        return
      }
      await client.login()
      renderSearch(await client.search(query, city, page, limit), format, page, query, city)
    })
    return 0
  } catch (error) {
    const known = isBossError(error)
    // Redirect URLs in raw browser errors may contain session credentials.
    process.stderr.write(JSON.stringify({ error: known ? error.message : "Browser operation failed: " + String(error instanceof Error ? error.message : error).replace(/https?:\/\/[^\s]+/g, "<url>").slice(0, 240),
      code: known ? error.code : "BROWSER_ERROR" }) + "\n")
    return 1
  }
}
if (import.meta.main) {
  const args = process.argv.slice(2)
  if (process.versions.bun && !args.includes("--cached-only") && !args.includes("--help") && !args.includes("-h")) {
    try {
      const { runNodeCLI } = await import("./runtime.js")
      process.exitCode = await runNodeCLI(args)
    } catch (error) {
      process.stderr.write(JSON.stringify({ code: isBossError(error) ? error.code : "NODE_WORKER_ERROR",
        error: isBossError(error) ? error.message : "Could not run Node browser worker" }) + "\n")
      process.exitCode = 1
    }
  } else process.exitCode = await main(args)
}
