import { portalMetadata as liepin } from "../../.agents/skills/liepin-search/cli/src/commands/search.js"
import { portalMetadata as zhaopin } from "../../.agents/skills/zhaopin-search/cli/src/commands/search.js"
import { portalMetadata as job51 } from "../../.agents/skills/51job-search/cli/src/commands/search.js"
export type Portal = "liepin" | "zhaopin" | "51job"
export class PortalError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = "PortalError" }
}
export function isPortalError(error: unknown): error is PortalError {
  return error instanceof Error && error.name === "PortalError"
    && typeof (error as PortalError).code === "string"
}
export const PORTALS = { liepin, zhaopin, "51job": job51 } as const
export interface Job {
  portal: Portal; id: string; title: string; company: string; location: string | null
  date: string | null; url: string; description: string; salary: string | null
  experience: string | null; degree: string | null; isActive: boolean | null; fetchedAt: string
}
export interface Card { id: string; url: string; title: string; company: string; location: string | null; salary: string | null; experience: string | null; degree: string | null }
export function jobAddress(portal: Portal, input: string): { id: string; url: string } {
  const raw = input.trim()
  if (portal === "liepin" && /^(?:(?:job|a)_)?\d{6,20}$/.test(raw)) {
    const [kind, id] = raw.includes("_") ? raw.split("_") : ["job", raw]
    return { id: kind + "_" + id, url: `${PORTALS.liepin.postingOrigin}/${kind}/${id}.shtml` }
  }
  if (portal === "zhaopin" && /^(?:CC|CZ)[A-Za-z0-9]{8,100}$/.test(raw)) {
    return { id: raw, url: `${PORTALS.zhaopin.postingOrigin}/jobdetail/${raw}.htm` }
  }
  if (portal === "51job" && /^\d{6,20}$/.test(raw)) {
    return { id: raw, url: `${PORTALS["51job"].postingOrigin}/all/${raw}.html` }
  }
  let url: URL
  try { url = new URL(raw) } catch { throw new PortalError("BAD_ID", "Use a documented job ID or HTTPS posting URL") }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new PortalError("BAD_ID", "Only HTTPS posting URLs without credentials/ports are accepted")
  let id: string | undefined
  if (portal === "liepin" && url.hostname === "www.liepin.com") {
    const match = url.pathname.match(/^\/(job|a)\/(\d{6,20})\.shtml$/)
    if (match) id = match[1] + "_" + match[2]
  }
  if (portal === "zhaopin" && ["www.zhaopin.com", "jobs.zhaopin.com"].includes(url.hostname)) {
    id = url.pathname.match(/^\/(?:jobdetail\/)?((?:CC|CZ)[A-Za-z0-9]{8,100})\.htm$/)?.[1]
  }
  if (portal === "51job" && url.hostname === "jobs.51job.com") id = url.pathname.match(/^\/[a-z0-9-]+\/(\d{6,20})\.html$/)?.[1]
  if (!id) throw new PortalError("BAD_ID", "URL does not belong to this portal's posting paths")
  url.search = ""; url.hash = ""
  return { id, url: url.href }
}
export const LIEPIN_CITIES: Record<string, string> = { 全国: "410", 北京: "010", 上海: "020", 天津: "030", 重庆: "040", 广州: "050020", 深圳: "050090", 苏州: "060080", 南京: "060020", 杭州: "070020", 大连: "210040", 成都: "280020", 武汉: "170020", 西安: "270020" }
export const ZHAOPIN_CITIES: Record<string, string> = { 杭州: "653" }
// Verified against the site's loaded public seo_dd_areas.js dictionary.
export const JOB51_CITIES: Record<string, string> = { 北京: "010000", 上海: "020000", 广州: "030200", 深圳: "040000", 武汉: "180200", 西安: "200200", 杭州: "080200", 南京: "070200", 成都: "090200", 重庆: "060000", 东莞: "030800" }
export function cityCode(portal: Portal, input: string): string {
  const city = input.trim().replace(/市$/, "")
  const code = portal === "liepin" ? LIEPIN_CITIES[city] ?? (/^\d{3}(?:\d{3})?$/.test(city) ? city : undefined)
    : portal === "zhaopin" ? ZHAOPIN_CITIES[city] ?? (/^\d{3}$/.test(city) ? city : undefined)
    : JOB51_CITIES[city] ?? (/^\d{6}$/.test(city) ? city : undefined)
  if (!code) throw new PortalError("BAD_LOCATION", "Use a documented city or this portal's documented numeric city code")
  return code
}
// The public 智联 search UI encodes UTF-16BE keyword bytes with base32hex.
// This is URL routing, not an authentication token or a signed API request.
export function zhaopinKeyword(query: string): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUV"
  let bits = 0, value = 0, result = ""
  for (let i = 0; i < query.length; i++) {
    const code = query.charCodeAt(i)
    for (const byte of [code >>> 8, code & 255]) {
      value = (value << 8) | byte; bits += 8
      while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31] }
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31]
  return result
}
export function searchUrl(portal: Portal, query: string, city: string, page = 1): string {
  const code = cityCode(portal, city)
  if (portal === "liepin") return "https://www.liepin.com/zhaopin/?" + new URLSearchParams({ key: query, city: code, dq: code, currentPage: String(page - 1), pageSize: "40" })
  if (portal === "zhaopin") return `https://www.zhaopin.com/sou/jl${code}/kw${zhaopinKeyword(query)}/p${page}`
  return PORTALS[portal].home + "?" + new URLSearchParams({ keyword: query, jobArea: code })
}
export function requireComplete(job: Job, portal: Portal, id?: string): Job {
  if (!job || typeof job !== "object" || typeof job.url !== "string"
      || typeof job.title !== "string" || typeof job.company !== "string"
      || typeof job.description !== "string" || typeof job.fetchedAt !== "string") {
    throw new PortalError("INCOMPLETE_JOB", "Invalid posting/snapshot schema")
  }
  id ??= job.id
  const address = jobAddress(portal, job.url)
  if (job.portal !== portal || address.id !== id || job.id !== id) throw new PortalError("WRONG_JOB", "Snapshot belongs to a different portal/posting")
  if (!job.title?.trim() || !job.company?.trim() || !job.description?.trim() || !Number.isFinite(Date.parse(job.fetchedAt))) {
    throw new PortalError("INCOMPLETE_JOB", "A title, company, complete description and capture time are required")
  }
  return job
}
export function formatJob(job: Job): string {
  return [job.title, `${job.company} · ${job.location ?? "—"}`, `URL: ${job.url}`,
    `Snapshot captured: ${job.fetchedAt} (not a live availability check)`,
    `Salary: ${job.salary ?? "unknown"}`, `Publication date: ${job.date ?? "unknown"}`, "", job.description].join("\n")
}
