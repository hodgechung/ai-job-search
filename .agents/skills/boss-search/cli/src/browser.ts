import type { Browser, Page, Response } from "playwright"
import { BossError, isBossError, ORIGIN, accessState, normalizeId, parseDetail, parseList, searchUrl, type Access, type Job } from "./helpers.js"
import { Store } from "./store.js"
import { readNativeSession, nativeEndpoint } from "./native.js"
export interface BrowserOptions { wait: boolean; timeout: number; browser: "chrome" | "chromium" }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const LIST_PATH = "/wapi/zpgeek/search/joblist.json"
export const DETAIL_PATH = "/wapi/zpgeek/job/detail.json"
function matches(response: Response, path: string): boolean {
  const url = new URL(response.url())
  return url.origin === ORIGIN && url.pathname === path
}
export class BossBrowser {
  constructor(readonly page: Page, readonly store: Store, readonly options: BrowserOptions) {}
  async state(): Promise<Access> {
    if (this.page.isClosed()) throw new BossError("BROWSER_CLOSED", "Browser closed; snapshots remain available")
    const body = await this.page.locator("body").innerText({ timeout: 3000 }).catch(() => "")
    const userVisible = await this.page.locator("li.nav-figure").first().isVisible().catch(() => false)
    const loginVisible = await this.page.getByRole("link", { name: /^(登录|登录\/注册|登录注册)$/ }).first().isVisible().catch(() => false)
    return accessState({ url: this.page.url(), body, userVisible, loginVisible })
  }
  async pause(state: "login_required" | "verification_required"): Promise<void> {
    if (!this.options.wait) throw new BossError(state === "login_required" ? "LOGIN_REQUIRED" : "VERIFICATION_REQUIRED",
      state === "login_required" ? "Run login, scan the QR code, then retry" : "Complete verification in the browser, then retry")
    process.stderr.write(state === "login_required"
      ? "BOSS 登录态失效：请在打开的浏览器扫码登录，成功后自动继续。\n"
      : "BOSS 安全验证：请在浏览器手动完成验证，程序将等待。\n")
    const deadline = Date.now() + this.options.timeout * 1000
    while (Date.now() < deadline) {
      if (await this.state() === "authenticated") return
      await sleep(1000)
    }
    throw new BossError("AUTH_TIMEOUT", "Login/verification timed out; retry to reuse the saved browser profile")
  }
  async navigate(url: string): Promise<void> {
    // Background tabs can suspend the animation frames used by click stability checks.
    // Activate only for explicit search/detail actions; login/status remain observe-only.
    await this.page.bringToFront()
    const response = await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    const status = response?.status()
    if (status === 429) throw new BossError("RATE_LIMITED", "BOSS returned 429; stop and try later")
    if (status === 403) throw new BossError("ACCESS_DENIED", "BOSS refused access; this is not proof of an expired login")
    if (status === 404) throw new BossError("NOT_FOUND", "Job/page not found")
    if (status && status >= 400) throw new BossError("HTTP_ERROR", "BOSS page returned HTTP " + status)
    await sleep(600)
    await this.checkGate()
  }
  async login(): Promise<void> {
    // Read the user's existing page. Never navigate or click a login control.
    let state = await this.state()
    for (let i = 0; state === "unknown" && i < 5; i++) { await sleep(400); state = await this.state() }
    if (state === "authenticated") return
    if (state === "unknown") throw new BossError("PAGE_CHANGED", "Could not establish login state on the current BOSS tab")
    await this.pause(state)
  }
  async checkGate(): Promise<void> {
    const state = await this.state()
    if (state === "login_required" || state === "verification_required") {
      await this.pause(state)
      // Do not navigate again as soon as the user finishes a QR/security handoff.
      throw new BossError("AUTH_RESUMED", "Authentication completed; rerun the command when the page is stable")
    }
  }
  async search(query: string, city: string, pageNumber: number, limit: number): Promise<Job[]> {
    let captured: Job[] | null = null
    const preloaded = new Map<string, Job>()
    let failure: BossError | null = null
    const listener = async (response: Response) => {
      if (matches(response, DETAIL_PATH)) {
        try { const job = parseDetail(await response.json()); preloaded.set(job.id, job) } catch { /* only selected full JDs are required */ }
        return
      }
      if (!matches(response, LIST_PATH)) return
      try {
        if (response.status() === 429) throw new BossError("RATE_LIMITED", "BOSS limited search; stop and try later")
        if (response.status() === 403) throw new BossError("ACCESS_DENIED", "BOSS refused search")
        captured = parseList(await response.json())
      } catch (error) { failure = isBossError(error) ? error : new BossError("PAGE_CHANGED", "Search response is not JSON") }
    }
    this.page.on("response", listener)
    const target = searchUrl(query, city, pageNumber)
    try {
      await this.navigate(target)
      const deadline = Date.now() + 15000
      while (captured === null && Date.now() < deadline) {
        if (failure) throw failure
        await this.checkGate()
        const cards = await this.page.locator("li.job-card-box").evaluateAll(elements => elements.map(el => {
          const a = el.querySelector<HTMLAnchorElement>("a.job-name, a[href*='/job_detail/']")
          return { href: a?.href ?? "", title: a?.textContent?.trim() ?? "",
            company: el.querySelector(".company-name, .boss-name")?.textContent?.trim() ?? null,
            location: el.querySelector(".job-area, .company-location")?.textContent?.trim() ?? null,
            salary: el.querySelector(".salary")?.textContent?.trim() ?? null }
        }))
        if (cards.length) captured = cards.flatMap(card => {
          try {
            return [{ id: normalizeId(card.href), title: card.title, company: card.company,
              location: card.location, salary: card.salary, date: null, url: card.href.split("?")[0],
              description: null, experience: null, degree: null, isActive: null, fetchedAt: new Date().toISOString() }]
          } catch { return [] }
        })
        if (captured === null) await sleep(300)
      }
      if (captured === null) throw new BossError("PAGE_CHANGED", "No jobList response/cards; refusing a false empty result")
      const unique = [...new Map((captured as Job[]).map(job => [job.id, job])).values()]
      const jobs: Job[] = []
      for (const card of unique.slice(0, limit)) {
        const cached = preloaded.get(card.id) ?? await this.store.get(card.id)
        if (cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 3600 * 1000) {
          await this.store.put(cached)
          jobs.push(cached)
          continue
        }
        const cardElement = this.page.locator("li.job-card-box").filter({
          has: this.page.locator('a[href*="/job_detail/' + card.id + '.html"]'),
        }).first()
        // Clicking a result card triggers the same detail request as normal use.
        const job = await this.detail(card.id, await cardElement.isVisible()
          ? () => cardElement.click({ timeout: 5000 }) : undefined)
        jobs.push(job)
        process.stderr.write("已保存完整 JD：" + jobs.length + "/" + Math.min(limit, unique.length) + "\n")
        await sleep(1000)
      }
      return jobs
    } finally { this.page.off("response", listener) }
  }
  async detail(id: string, trigger?: () => Promise<void>): Promise<Job> {
    let captured: Job | null = null
    let failure: BossError | null = null
    const listener = async (response: Response) => {
      if (!matches(response, DETAIL_PATH)) return
      try {
        if (response.status() === 429) throw new BossError("RATE_LIMITED", "BOSS limited detail; stop and try later")
        if (response.status() === 403) throw new BossError("ACCESS_DENIED", "BOSS refused detail")
        captured = parseDetail(await response.json(), id)
      } catch (error) {
        if (isBossError(error) && error.code === "WRONG_JOB") return
        failure = isBossError(error) ? error : new BossError("PAGE_CHANGED", "Detail response is not JSON")
      }
    }
    this.page.on("response", listener)
    const target = ORIGIN + "/job_detail/" + id + ".html"
    try {
      if (trigger) { await this.page.bringToFront(); await trigger() }
      else await this.navigate(target)
      const deadline = Date.now() + 15000
      while (captured === null && Date.now() < deadline) {
        if (failure) throw failure
        await this.checkGate()
        const closed = await this.page.getByText(/该职位已(?:关闭|停止|暂停)|职位已下线/).first().isVisible().catch(() => false)
        if (closed) throw new BossError("JOB_CLOSED", "This posting is no longer recruiting")
        await sleep(250)
      }
      if (!captured) throw new BossError("INCOMPLETE_JOB", "No full detail response; no title-only snapshot was stored")
      await this.store.put(captured)
      return captured
    } finally { this.page.off("response", listener) }
  }
}
export async function withBrowser<T>(store: Store, options: BrowserOptions, run: (client: BossBrowser) => Promise<T>): Promise<T> {
  const unlock = await store.lock()
  let browser: Browser | undefined
  // Closing a connectOverCDP connection disconnects it; it must not close the
  // external browser/context. The isolated integration suite verifies this.
  const disconnect = () => { void browser?.close().catch(() => {}) }
  try {
    const session = await readNativeSession(store)
    if (!session) throw new BossError("LOGIN_REQUIRED", "Run login to open dedicated Chrome, then complete login before status/search")
    let endpoint: string
    try { endpoint = await nativeEndpoint(session) }
    catch { throw new BossError("BROWSER_UNAVAILABLE", "Dedicated Chrome is unreachable; inspect its window or run login") }
    const { chromium } = await import("playwright")
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10000, noDefaults: true })
    const context = browser.contexts()[0]
    if (!context) throw new BossError("BROWSER_UNAVAILABLE", "No dedicated Chrome context")
    const page = context.pages().filter(page => {
      try { return new URL(page.url()).origin === ORIGIN } catch { return false }
    }).at(-1)
    if (!page) throw new BossError("BOSS_TAB_REQUIRED", "Open zhipin.com in the dedicated Chrome window; no tab will be opened automatically")
    process.once("SIGINT", disconnect)
    process.once("SIGTERM", disconnect)
    return await run(new BossBrowser(page, store, options))
  } finally {
    process.off("SIGINT", disconnect)
    process.off("SIGTERM", disconnect)
    await browser?.close().catch(() => {})
    await unlock()
  }
}
