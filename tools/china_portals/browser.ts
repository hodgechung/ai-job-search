import type { Browser, Page } from "playwright"
import { PortalError, PORTALS, jobAddress, requireComplete, searchUrl, type Card, type Job, type Portal } from "./model.js"
import { readNativeSession, nativeEndpoint } from "./native.js"
import { Store } from "./store.js"
import { publicLiepinDetail, type PublicFetcher } from "./liepin.js"
import { publicZhaopinDetail, publicZhaopinSearch } from "./zhaopin.js"

export const CARD_SELECTORS: Record<Portal, string> = { liepin: ".jobDetailBox", zhaopin: ".joblist-box__item", "51job": ".joblist-item-job" }
export const DESCRIPTION_SELECTORS: Record<Portal, string> = {
  liepin: '[data-selector="job-intro-content"]', zhaopin: ".describtion-card__detail-content", "51job": ".bmsg.job_msg",
}
export interface Options { timeout: number; browser: "chrome" | "chromium" }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export class Client {
  constructor(readonly page: Page, readonly store: Store, readonly options: Options, readonly publicFetch: PublicFetcher = fetch) {}
  get portal(): Portal { return this.store.portal }
  async gate(): Promise<void> {
    if (this.page.isClosed()) throw new PortalError("BROWSER_CLOSED", "Browser tab closed; cached JDs remain available")
    const url = new URL(this.page.url())
    if (url.hostname === "safe.liepin.com" || /(?:captcha|\/security|\/verify)/i.test(url.pathname)
        || await this.page.locator('.waf-nc-h5-description').count() > 0
        || await this.page.locator('.waf-nc-h5-description, .nc_wrapper, #nc_1_wrapper').first().isVisible().catch(() => false)) {
      throw new PortalError("VERIFICATION_REQUIRED", "Complete verification in the preserved dedicated Chrome tab, then retry; no automatic retry")
    }
    if (url.hostname === "passport.zhaopin.com" || url.hostname === "login.51job.com") {
      throw new PortalError("LOGIN_REQUIRED", "Complete login in the dedicated Chrome tab, then retry")
    }

  }
  async navigate(url: string): Promise<void> {
    await this.gate()
    const response = await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: this.options.timeout * 1000 })
    if (response?.status() === 429) throw new PortalError("RATE_LIMITED", "Site returned 429; stop and try later")
    if (response?.status() === 403) throw new PortalError("ACCESS_DENIED", "Site refused access; no automatic retry")
    if (response?.status() === 404) throw new PortalError("NOT_FOUND", "Posting/page not found")
    if (response && response.status() >= 400) throw new PortalError("HTTP_ERROR", "Site returned HTTP " + response.status())
    await this.gate()
  }
  async waitFor(selector: string): Promise<void> {
    const deadline = Date.now() + this.options.timeout * 1000
    while (Date.now() < deadline) {
      await this.gate()
      if (await this.page.locator(selector).first().isVisible().catch(() => false)) return
      if (this.page.url() === "about:blank") throw new PortalError("PAGE_CHANGED", "The portal left the requested page; refusing an empty result")
      await sleep(300)
    }
    throw new PortalError("PAGE_CHANGED", "Expected content did not load; refusing a false empty result")
  }
  async cards(): Promise<Card[]> {
    const raw = await this.page.locator(CARD_SELECTORS[this.portal]).evaluateAll((elements, portal) => elements.map(el => {
      const text = (selector: string) => el.querySelector<HTMLElement>(selector)?.innerText.trim() || null
      if (portal === "liepin") {
        const a = el.querySelector<HTMLAnchorElement>('a[data-nick="job-detail-job-info"]')
        const lines = a?.innerText.split("\n").map(s => s.trim()).filter(Boolean) ?? []
        return { url: a?.href, title: text('.jobTitleBox [title]'), company: text('.companyName'), location: text('.jobTitleBox span.ellipsis-1'),
          salary: lines.find(s => /\d.*(?:[kK]|万|千|元)|面议/.test(s)) ?? null,
          experience: lines.find(s => /^(?:\d.*年|经验不限|应届生|实习生)$/.test(s)) ?? null,
          degree: lines.find(s => /^(?:统招)?(?:本科|大专|硕士|博士|学历不限|高中|中专)/.test(s)) ?? null }
      }
      if (portal === "zhaopin") {
        const a = el.querySelector<HTMLAnchorElement>('a.jobinfo__name')
        const info = [...el.querySelectorAll<HTMLElement>('.jobinfo__other-info-item')].map(e => e.innerText.trim())
        return { url: a?.href, title: a?.innerText.trim(), company: text('.companyinfo__name'), location: info[0] ?? null,
          salary: text('.jobinfo__salary'), experience: info[1] ?? null, degree: info[2] ?? null }
      }
      let data: Record<string, unknown> = {}
      try { data = JSON.parse(el.getAttribute('sensorsdata') ?? '{}') } catch { /* no synthetic ID fallback */ }
      return { url: /^\d{6,20}$/.test(String(data.jobId)) ? `https://jobs.51job.com/all/${data.jobId}.html` : null,
        title: text('.jname'), company: text('.cname'), location: text('.area'), salary: text('.sal'),
        experience: typeof data.jobYear === 'string' ? data.jobYear : null, degree: typeof data.jobDegree === 'string' ? data.jobDegree : null }
    }), this.portal)
    const unique = new Map<string, Card>()
    for (const card of raw) {
      if (!card.url || !card.title || !card.company) continue
      try {
        // The site's own 智联 links still use HTTP. Upgrade only known posting
        // links before strict URL validation; caller-supplied HTTP is rejected.
        const address = jobAddress(this.portal, card.url.replace(/^http:\/\/(www\.zhaopin\.com|jobs\.zhaopin\.com)\//, "https://$1/"))
        unique.set(address.id, { ...card, title: card.title, company: card.company, ...address })
      } catch { /* malformed/foreign card cannot become an arbitrary navigation */ }
    }
    if (raw.length && !unique.size) throw new PortalError("PAGE_CHANGED", "Cards were present but none matched this portal's posting schema")
    return [...unique.values()]
  }
  async search(query: string, city: string, limit: number): Promise<Job[]> {
    if (this.portal === "zhaopin") {
      await this.gate()
      return publicZhaopinSearch(this.store, query, city, limit, this.options.timeout, this.publicFetch)
    }
    const target = searchUrl(this.portal, query, city)
    if (this.portal === "51job") {
      const expected = new URL(target).searchParams
      // The public search URL initializes the filters before the first result
      // request. Observe that normal browser request; never replay the API.
      const responsePromise = this.page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.origin === "https://we.51job.com" && url.pathname === "/api/job/search-pc"
          && url.searchParams.get("keyword") === query && url.searchParams.get("jobArea") === expected.get("jobArea")
      }, { timeout: this.options.timeout * 1000 })
      void responsePromise.catch(() => {})
      await this.navigate(target)
      const response = await responsePromise
      if (response.status() === 429) throw new PortalError("RATE_LIMITED", "Site limited search; stop")
      if (response.status() === 403) throw new PortalError("ACCESS_DENIED", "Site refused search")
      const payload = await response.json()
      if (!payload?.resultbody?.job || typeof payload.resultbody.job !== "object") {
        const message = typeof payload?.message === "string" ? payload.message : ""
        const code = /登录|登陆/.test(message) ? "LOGIN_REQUIRED" : /验证|安全/.test(message) ? "VERIFICATION_REQUIRED" : /频繁|限制|稍后/.test(message) ? "RATE_LIMITED" : "API_ERROR"
        throw new PortalError(code, "Search response did not contain a job result; preserve the page and inspect access")
      }
    } else await this.navigate(target)
    await this.waitFor(CARD_SELECTORS[this.portal])
    const cards = (await this.cards()).filter(card => /^\d+$/.test(city) || city === "全国" || card.location?.includes(city.replace(/市$/, "")))
    if (!cards.length) throw new PortalError("NO_MATCHING_LOCATION", "The site returned cards but none matched the requested city")
    const jobs: Job[] = []
    for (const card of cards.slice(0, limit)) {
      const cached = await this.store.get(card.id)
      const reusable = cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 3600000
      const job = reusable ? { ...cached, location: cached.location ?? card.location, salary: cached.salary ?? card.salary,
        experience: cached.experience ?? card.experience, degree: cached.degree ?? card.degree } : await this.detail(card.url, card)
      if (reusable) await this.store.put(job)
      jobs.push(job)
      process.stderr.write(`已保存完整 JD：${jobs.length}/${Math.min(limit, cards.length)}\n`)
      await sleep(800)
    }
    return jobs
  }
  async detail(input: string, card?: Card, refresh = false): Promise<Job> {
    const address = jobAddress(this.portal, input)
    if (this.portal === "liepin" || this.portal === "zhaopin") {
      await this.gate()
      const capture = this.portal === "liepin" ? publicLiepinDetail : publicZhaopinDetail
      const job = await capture(input, this.options.timeout, card, this.publicFetch)
      await this.store.put(job)
      return job
    }
    let alreadyLoaded = false
    try { alreadyLoaded = jobAddress(this.portal, this.page.url()).id === address.id && await this.page.locator(DESCRIPTION_SELECTORS[this.portal]).first().isVisible() } catch { /* another page */ }
    // A manually verified posting can be captured as-is. Reload only when the
    // caller explicitly requested --refresh or this is a different posting.
    if (refresh || !alreadyLoaded) await this.navigate(address.url)
    await this.waitFor(DESCRIPTION_SELECTORS[this.portal])
    await this.gate()
    if (jobAddress(this.portal, this.page.url()).id !== address.id) throw new PortalError("WRONG_JOB", "The portal redirected to a different posting")
    const description = await this.page.locator(DESCRIPTION_SELECTORS[this.portal]).first().innerText()
    const heading = await this.page.locator('h1').first().innerText().catch(() => "")
    const companySelector = '.com_name, .company-name, .cname'
    const company = await this.page.locator(companySelector).first().innerText().catch(() => "")
    if (!description.trim()) throw new PortalError("INCOMPLETE_JOB", "The posting description is empty")
    // Job requirements may legitimately describe login/QR features. Only an
    // actual gate (above) or an entire login prompt is authentication evidence.
    if (/^(?:请)?登录(?:后)?查看(?:完整)?(?:职位|岗位)(?:描述|信息)[。！!]?$/u.test(description.trim())) {
      throw new PortalError("LOGIN_REQUIRED", "Complete login before capturing the full description")
    }
    const job: Job = { portal: this.portal, ...address, title: heading.trim() || card?.title || "", company: company.trim() || card?.company || "",
      location: card?.location ?? null, salary: card?.salary ?? null, experience: card?.experience ?? null, degree: card?.degree ?? null,
      description: description.trim(), date: null, isActive: null, fetchedAt: new Date().toISOString() }
    requireComplete(job, this.portal)
    await this.store.put(job)
    return job
  }
}
export async function withBrowser<T>(store: Store, options: Options, create: boolean, run: (client: Client) => Promise<T>): Promise<T> {
  const unlock = await store.lock(); let browser: Browser | undefined
  const disconnect = () => { void browser?.close().catch(() => {}) }
  try {
    const session = await readNativeSession(store)
    if (!session) throw new PortalError("BROWSER_REQUIRED", "Run this portal's open command to start dedicated Chrome; public jobs do not require login")
    const { chromium } = await import("playwright")
    browser = await chromium.connectOverCDP(await nativeEndpoint(session), { noDefaults: true, timeout: 10000 })
    const context = browser.contexts()[0]
    if (!context) throw new PortalError("BROWSER_UNAVAILABLE", "Dedicated Chrome has no context")
    let page = context.pages().filter(p => {
      try { return (PORTALS[store.portal].hosts as readonly string[]).includes(new URL(p.url()).hostname) } catch { return false }
    }).at(-1)
    if (!page && create) page = await context.newPage()
    if (!page) throw new PortalError("PORTAL_TAB_REQUIRED", "Open this portal in the dedicated Chrome window first; status never opens a tab")
    process.once("SIGINT", disconnect); process.once("SIGTERM", disconnect)
    return await run(new Client(page, store, options))
  } finally {
    process.off("SIGINT", disconnect); process.off("SIGTERM", disconnect)
    await browser?.close().catch(() => {}); await unlock()
  }
}
