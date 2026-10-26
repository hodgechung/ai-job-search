export const ORIGIN = "https://www.zhipin.com"
export class BossError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "BossError" }
}
// Node worker bundling can create more than one copy of an error constructor.
// Preserve the public error code across that boundary instead of relying on instanceof.
export function isBossError(value: unknown): value is BossError {
  return value instanceof Error && value.name === "BossError"
    && typeof (value as BossError).code === "string" && /^[A-Z_]+$/.test((value as BossError).code)
}
export interface Job {
  id: string; title: string; company: string | null; location: string | null
  date: string | null; url: string; description: string | null; salary: string | null
  experience: string | null; degree: string | null; isActive: boolean | null; fetchedAt: string
}
export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}
export function plain(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  // The downstream posting_guard still checks the resulting text.
  return raw.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim() || null
}
export function normalizeId(input: string): string {
  const raw = input.trim()
  if (/^[A-Za-z0-9_~-]{6,200}$/.test(raw)) return raw
  let url: URL
  try { url = new URL(raw) } catch { throw new BossError("BAD_ID", "Use a BOSS job ID or HTTPS job_detail URL") }
  if (url.protocol !== "https:" || !["www.zhipin.com", "zhipin.com"].includes(url.hostname)
      || url.username || url.password || url.port) {
    throw new BossError("BAD_ID", "Only HTTPS zhipin.com job_detail URLs are accepted")
  }
  const match = url.pathname.match(/^\/job_detail\/([A-Za-z0-9_~-]{6,200})\.html$/)
  if (!match) throw new BossError("BAD_ID", "Not a BOSS job_detail URL")
  return match[1]
}
export function jobUrl(id: string): string { return ORIGIN + "/job_detail/" + normalizeId(id) + ".html" }
const CITIES: Record<string, string> = {
  北京: "101010100", 上海: "101020100", 广州: "101280100", 深圳: "101280600",
  杭州: "101210100", 成都: "101270100", 武汉: "101200100", 南京: "101190100",
  苏州: "101190400", 西安: "101110100", 天津: "101030100", 重庆: "101040100", 全国: "100010000",
}
export function cityCode(value: string): string {
  const clean = value.trim().replace(/市$/, "")
  const code = CITIES[clean] ?? (/^\d{9}$/.test(clean) ? clean : undefined)
  if (!code) throw new BossError("BAD_LOCATION", "Use a documented Chinese city name or the site's 9-digit city code")
  return code
}
export function searchUrl(query: string, city: string, page = 1): string {
  return ORIGIN + "/web/geek/job?" + new URLSearchParams({ query, city: cityCode(city), page: String(page) })
}
function apiData(payload: unknown): Record<string, unknown> {
  const root = object(payload)
  if (root.code !== undefined && root.code !== 0 && root.code !== "0") {
    const message = text(root.message) ?? ""
    if (/登录|登陆/.test(message)) throw new BossError("LOGIN_REQUIRED", "BOSS requires login; run login")
    if (/验证|安全/.test(message)) throw new BossError("VERIFICATION_REQUIRED", "Complete verification in the browser")
    if (/频繁|稍后|限制/.test(message)) throw new BossError("RATE_LIMITED", "BOSS limited access; stop and try later")
    throw new BossError("API_ERROR", "BOSS returned an unsuccessful API response")
  }
  return object(root.zpData)
}
function makeJob(info: Record<string, unknown>, company: unknown, id: string): Job {
  const status = text(info.jobStatusDesc)
  return {
    id,
    title: text(info.jobName) ?? "",
    company: text(company),
    location: text(info.locationName) ?? text(info.cityName),
    // Refresh/activity timestamps are not publication dates. Unknown stays null.
    date: null,
    url: jobUrl(id),
    description: plain(info.postDescription),
    salary: text(info.salaryDesc), experience: text(info.experienceName) ?? text(info.jobExperience),
    degree: text(info.degreeName) ?? text(info.jobDegree),
    isActive: status ? !/关闭|停止|暂停|下线|结束|过期/.test(status) : null,
    fetchedAt: new Date().toISOString(),
  }
}
export function parseList(payload: unknown): Job[] {
  const data = apiData(payload)
  if (!Array.isArray(data.jobList)) throw new BossError("PAGE_CHANGED", "BOSS response has no jobList")
  const jobs = data.jobList.flatMap(raw => {
    const info = object(raw)
    try {
      const id = normalizeId(String(info.encryptJobId ?? info.encryptId ?? ""))
      const job = makeJob(info, info.brandName, id)
      return job.title && job.company ? [job] : []
    } catch { return [] }
  })
  if (data.jobList.length && !jobs.length) throw new BossError("PAGE_CHANGED", "Search returned cards but none match the expected schema")
  return jobs
}
export function parseDetail(payload: unknown, expectedId?: string): Job {
  const data = apiData(payload)
  const info = object(data.jobInfo)
  const id = normalizeId(String(info.encryptId ?? info.encryptJobId ?? ""))
  if (expectedId && id !== expectedId) throw new BossError("WRONG_JOB", "Detail response belongs to another posting")
  const job = makeJob(info, object(data.brandComInfo).brandName, id)
  if (!job.title || !job.company || !job.description) {
    throw new BossError("INCOMPLETE_JOB", "BOSS did not return title, company and full job description")
  }
  return job
}
export type Access = "authenticated" | "login_required" | "verification_required" | "unknown"
export interface PageState { url: string; userVisible: boolean; loginVisible: boolean; body: string }
export function accessState(state: PageState): Access {
  if (/\/web\/(?:passport\/zp\/(?:security|verify)|user\/safe\/)|security-check/.test(state.url)
      || (!state.userVisible && /请完成.{0,8}(?:验证|滑块)|访问异常|安全验证/.test(state.body))) return "verification_required"
  if (state.loginVisible || (!state.userVisible && /扫码登录|扫码登陆|请先登录|登录后继续/.test(state.body))
      || /\/web\/user\/?(?:\?|$)/.test(state.url) && !state.userVisible) return "login_required"
  return state.userVisible ? "authenticated" : "unknown"
}
export function formatDetail(job: Job): string {
  return [job.title, (job.company ?? "—") + " · " + (job.location ?? "—"), "URL: " + job.url,
    "Snapshot captured: " + job.fetchedAt + " (not a live availability check)",
    job.salary ? "Salary: " + job.salary : "", "Active: " + (job.isActive ?? "unknown"),
    "", job.description ?? ""].join("\n")
}
