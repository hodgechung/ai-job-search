import { PortalError, jobAddress, requireComplete, type Card, type Job } from "./model.js"

import { plain, block, classMatch } from "./html.js"

export function parseLiepinDetail(html: string, input: string, card?: Card): Job {
  const address = jobAddress("liepin", input)
  const header = block(html, "div", classMatch("job-apply-content")) ?? ""
  const companyCard = block(html, "div", classMatch("company-card")) ?? ""
  const description = block(html, "dd", /data-selector=["']job-intro-content["']/i)
  const props = block(header, "div", classMatch("job-properties")) ?? ""
  const values = [...props.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map(m => plain(m[1])).filter(Boolean)
  const job: Job = {
    portal: "liepin", ...address,
    title: plain(block(header, "span", classMatch("name")) ?? ""),
    company: plain(block(companyCard, "div", classMatch("name")) ?? ""),
    description: description ? plain(description) : "",
    location: values[0] ?? card?.location ?? null,
    experience: values[1] ?? card?.experience ?? null,
    degree: values[2] ?? card?.degree ?? null,
    salary: plain(block(header, "span", classMatch("salary")) ?? "") || card?.salary || null,
    date: null, isActive: null, fetchedAt: new Date().toISOString(),
  }
  return requireComplete(job, "liepin", address.id)
}
/** Public, robots-permitted detail HTML; no credentials or signed API replay. */
export type PublicFetcher = (url: string, init: RequestInit) => Promise<Response>
export async function publicLiepinDetail(input: string, timeout: number, card?: Card, fetcher: PublicFetcher = fetch): Promise<Job> {
  const expected = jobAddress("liepin", input)
  let target = expected.url
  for (let redirects = 0; redirects < 3; redirects++) {
    const response = await fetcher(target, { headers: { "User-Agent": "Mozilla/5.0 (compatible; liepin-search-cli/0.1)" }, redirect: "manual", signal: AbortSignal.timeout(timeout * 1000) })
    if (response.status === 429) throw new PortalError("RATE_LIMITED", "Liepin limited access; stop and try later")
    if (response.status === 403) throw new PortalError("ACCESS_DENIED", "Liepin refused access; no retry")
    if (response.status === 404) throw new PortalError("NOT_FOUND", "Posting not found")
    if (response.status >= 300 && response.status < 400) {
      const next = new URL(response.headers.get("location") ?? "", target)
      if (next.hostname === "safe.liepin.com") throw new PortalError("VERIFICATION_REQUIRED", "Complete Liepin verification manually; public detail access stopped")
      if (jobAddress("liepin", next.href).id !== expected.id) throw new PortalError("WRONG_JOB", "Detail redirect changed posting ID")
      target = next.href; continue
    }
    if (!response.ok) throw new PortalError("HTTP_ERROR", "Liepin returned HTTP " + response.status)
    const html = await response.text()
    const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""
    if (/验证|captcha|访问异常/i.test(title)) throw new PortalError("VERIFICATION_REQUIRED", "Liepin returned a verification page; stop")
    if (/登录|登陆/.test(title)) throw new PortalError("LOGIN_REQUIRED", "Liepin returned a login page")
    return parseLiepinDetail(html, expected.url, card)
  }
  throw new PortalError("PAGE_CHANGED", "Too many posting redirects; stopped without retry")
}
