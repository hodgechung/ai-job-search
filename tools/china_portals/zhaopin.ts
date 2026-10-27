import { PortalError, jobAddress, requireComplete, searchUrl, type Card, type Job } from "./model.js"
import { plain, block, blocks, classMatch } from "./html.js"
import { Store } from "./store.js"
import type { PublicFetcher } from "./liepin.js"

export function parseZhaopinDetail(html: string, input: string, card?: Card): Job {
  const address = jobAddress("zhaopin", input)
  // The anonymous server response includes the entire text. guest-clamp only
  // folds its display; parse the supplied HTML without changing the site's UI.
  const description = plain(block(html, "div", classMatch("describtion-card__detail-content")) ?? "")
  if (/^(?:请)?(?:登录|登陆)(?:后)?查看(?:完整)?(?:职位|岗位)(?:描述|信息)[。！!]?$/u.test(description)) {
    throw new PortalError("LOGIN_REQUIRED", "The server supplied only a login prompt")
  }
  return requireComplete({
    portal: "zhaopin", ...address,
    title: plain(block(html, "h1", classMatch("summary-planes__title")) ?? ""),
    company: plain(block(html, "a", classMatch("company-info__name")) ?? ""),
    description, location: card?.location ?? null,
    salary: card?.salary ?? (plain(block(html, "span", classMatch("summary-planes__salary")) ?? "") || null),
    experience: card?.experience ?? null, degree: card?.degree ?? null,
    date: null, isActive: null, fetchedAt: new Date().toISOString(),
  }, "zhaopin", address.id)
}

/** Anonymous public posting HTML; no Cookie, browser credentials or API replay. */
export async function publicZhaopinDetail(input: string, timeout: number, card?: Card, fetcher: PublicFetcher = fetch): Promise<Job> {
  const expected = jobAddress("zhaopin", input)
  return parseZhaopinDetail(await publicHTML(expected.url, timeout, fetcher), expected.url, card)
}
async function publicHTML(initial: string, timeout: number, fetcher: PublicFetcher): Promise<string> {
  let target = initial
  for (let redirects = 0; redirects < 3; redirects++) {
    const response = await fetcher(target, { headers: { "User-Agent": "Mozilla/5.0 (compatible; zhaopin-search-cli/0.1)" }, redirect: "manual", signal: AbortSignal.timeout(timeout * 1000) })
    if (response.status === 429) throw new PortalError("RATE_LIMITED", "Zhaopin limited access; stop and try later")
    if (response.status === 403) throw new PortalError("ACCESS_DENIED", "Zhaopin refused access; no retry")
    if (response.status === 404) throw new PortalError("NOT_FOUND", "Posting not found")
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get("location") ?? "", target)
      if (next.hostname === "passport.zhaopin.com") throw new PortalError("LOGIN_REQUIRED", "Zhaopin redirected to login")
      if (/captcha|\/security|\/verify/i.test(next.pathname)) throw new PortalError("VERIFICATION_REQUIRED", "Zhaopin requires manual verification")
      if (initial.includes("/jobdetail/")) {
        if (jobAddress("zhaopin", next.href).id !== jobAddress("zhaopin", initial).id) throw new PortalError("WRONG_JOB", "Detail redirect changed posting ID")
      } else if (next.origin !== new URL(initial).origin || next.pathname !== new URL(initial).pathname || next.search) {
        throw new PortalError("PAGE_CHANGED", "Public search redirected to a different route; stop")
      }
      target = next.href; continue
    }
    if (!response.ok) throw new PortalError("HTTP_ERROR", "Zhaopin returned HTTP " + response.status)
    const html = await response.text()
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
    if (/验证|captcha|访问异常/i.test(title)) throw new PortalError("VERIFICATION_REQUIRED", "Zhaopin returned a verification page; stop")
    if (/登录|登陆/.test(title)) throw new PortalError("LOGIN_REQUIRED", "Zhaopin returned a login page")
    return html
  }
  throw new PortalError("PAGE_CHANGED", "Too many posting redirects; stopped without retry")
}

export function parseZhaopinCards(html: string): Card[] {
  const cards = new Map<string, Card>()
  for (const content of blocks(html, "div", classMatch("joblist-box__item"))) {
    const link = [...content.matchAll(/<a\b[^>]*>/gi)].find(m => classMatch("jobinfo__name").test(m[0]))?.[0]
    const href = link?.match(/href=["']([^"']+)["']/i)?.[1]
    if (!href) continue
    let address: ReturnType<typeof jobAddress>
    try { address = jobAddress("zhaopin", href.replace(/^http:\/\/(www\.zhaopin\.com|jobs\.zhaopin\.com)\//, "https://$1/")) } catch { continue }
    const info = blocks(content, "div", classMatch("jobinfo__other-info-item")).map(plain)
    const title = plain(block(content, "a", classMatch("jobinfo__name")) ?? "")
    const company = plain(block(content, "a", classMatch("companyinfo__name")) ?? "")
    if (title && company) cards.set(address.id, { ...address, title, company, location: info[0] || null,
      experience: info[1] || null, degree: info[2] || null,
      salary: plain(block(content, "p", classMatch("jobinfo__salary")) ?? "") || null })
  }
  if (!cards.size) throw new PortalError("PAGE_CHANGED", "Public HTML did not supply valid posting cards; refusing a false empty result")
  return [...cards.values()]
}
export async function publicZhaopinSearch(store: Store, query: string, city: string, limit: number, timeout: number, fetcher: PublicFetcher = fetch): Promise<Job[]> {
  const cards = parseZhaopinCards(await publicHTML(searchUrl("zhaopin", query, city), timeout, fetcher))
    .filter(card => /^\d+$/.test(city) || card.location?.includes(city.replace(/市$/, "")))
  if (!cards.length) throw new PortalError("NO_MATCHING_LOCATION", "Public cards did not match the requested city")
  const jobs: Job[] = []
  for (const card of cards.slice(0, limit)) {
    const cached = await store.get(card.id)
    const job = cached && Date.now() - Date.parse(cached.fetchedAt) < 24 * 3600000 ? cached
      : await publicZhaopinDetail(card.url, timeout, card, fetcher)
    await store.put(job); jobs.push(job)
    if (jobs.length < Math.min(limit, cards.length)) await new Promise(resolve => setTimeout(resolve, 800))
  }
  return jobs
}
