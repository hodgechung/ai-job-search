import { test, expect } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { accessState, cityCode, normalizeId, parseDetail, parseList, searchUrl } from "../src/helpers.js"
import { DEFAULT_DATA_DIR, Store } from "../src/store.js"
export const ID = "example_JOB_123"
export function detailPayload(id = ID) {
  return { code: 0, zpData: { jobInfo: { encryptId: id, jobName: "Python工程师",
    locationName: "上海", salaryDesc: "20-30K·14薪", postDescription: "负责 Python 后端开发\n要求：三年经验",
    jobStatusDesc: "招聘中", experienceName: "3-5年", degreeName: "本科" },
    brandComInfo: { brandName: "合成测试公司" } } }
}
test("normalization rejects foreign hosts, credentials and traversal", () => {
  expect(normalizeId("https://www.zhipin.com/job_detail/" + ID + ".html?ka=test")).toBe(ID)
  for (const value of ["../escape", "https://www.zhipin.com.evil.test/job_detail/" + ID + ".html",
    "https://www.zhipin.com@evil.test/job_detail/" + ID + ".html",
    "https://user@www.zhipin.com/job_detail/" + ID + ".html",
    "http://www.zhipin.com/job_detail/" + ID + ".html"]) expect(() => normalizeId(value)).toThrow()
})
test("city/keyword encoding and unknown cities never silently widen the search", () => {
  const url = new URL(searchUrl("C++ 后端", "上海市"))
  expect(url.searchParams.get("query")).toBe("C++ 后端")
  expect(url.searchParams.get("city")).toBe("101020100")
  expect(cityCode("101280600")).toBe("101280600")
  expect(() => cityCode("不存在的城市")).toThrow()
})
test("full JD contract rejects wrong job, missing body and non-success API responses", () => {
  const job = parseDetail(detailPayload(), ID)
  expect(job.company).toBe("合成测试公司")
  expect(job.date).toBeNull()
  expect(job.description).toContain("三年经验")
  expect(() => parseDetail(detailPayload(), "another_id")).toThrow("another posting")
  const missing = detailPayload(); missing.zpData.jobInfo.postDescription = ""
  expect(() => parseDetail(missing, ID)).toThrow("full job description")
  expect(() => parseDetail({ code: 37, message: "请先登录" }, ID)).toThrow("login")
  expect(() => parseList({ code: 0, zpData: {} })).toThrow("jobList")
  expect(parseList({ code: 0, zpData: { jobList: [] } })).toEqual([])
  expect(() => parseList({ code: 0, zpData: { jobList: [{ newUnknownSchema: true }] } })).toThrow("expected schema")
})
test("publication date is unknown even when site supplies a refresh/activity time", () => {
  expect(parseList({ code: 0, zpData: { jobList: [{ encryptJobId: ID, jobName: "开发",
    brandName: "公司", lastModifyTime: 123456, activeTimeDesc: "刚刚活跃" }] } })[0].date).toBeNull()
})
test("login detection checks actual page state, keeps challenges separate", () => {
  const state = { url: "https://www.zhipin.com/web/geek/job", userVisible: true, loginVisible: false, body: "职位列表" }
  expect(accessState(state)).toBe("authenticated")
  expect(accessState({ ...state, body: "负责安全验证、扫码登录功能开发" })).toBe("authenticated")
  expect(accessState({ ...state, userVisible: false, loginVisible: true })).toBe("login_required")
  expect(accessState({ ...state, userVisible: false })).toBe("unknown")
  expect(accessState({ ...state, url: "https://www.zhipin.com/web/passport/zp/security.html" })).toBe("verification_required")
})
test("cache is private, independent of cwd, and session lock prevents concurrent browser use", async () => {
  expect(resolve(DEFAULT_DATA_DIR)).toBe(resolve(import.meta.dir, "../../../../../job_scraper/boss"))
  const dir = await mkdtemp(join(tmpdir(), "boss-store-"))
  try {
    const store = new Store(dir), job = parseDetail(detailPayload(), ID)
    await store.put(job)
    expect(await store.get(ID)).toEqual(job)
    if (process.platform !== "win32") expect((await stat(join(dir, "jobs", ID + ".json"))).mode & 0o777).toBe(0o600)
    const unlock = await store.lock()
    await expect(store.lock()).rejects.toThrow("Another BOSS")
    await unlock()
    const release = await store.lock(); await release()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
async function cli(args: string[]) {
  const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "../src/cli.ts"), ...args], { stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { stdout, stderr, code }
}
test("CLI rejects unsupported/missing filters before browser startup", async () => {
  for (const args of [["search", "-q", "Python"], ["search", "-q", "Python", "-l", "上海", "--jobage", "7"],
    ["search", "-q", "Python", "-l", "上海", "-n", "21"], ["detail", ID, "--refresh", "--cached-only"],
    ["search", "-q", "Python", "-l", "上海", "--page", "2"]]) {
    const result = await cli(args)
    expect(result.code).toBe(1); expect(result.stdout).toBe("")
    expect(JSON.parse(result.stderr).code).not.toBe("BROWSER_UNAVAILABLE")
  }
})
test("cached detail works in a separate process without opening a browser, and malformed snapshots fail clearly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boss-cli-"))
  try {
    const store = new Store(dir); await store.put(parseDetail(detailPayload(), ID))
    const result = await cli(["detail", ID, "--cached-only", "--data-dir", dir])
    expect(result.code).toBe(0); expect(result.stderr).toBe("")
    expect(JSON.parse(result.stdout).source).toBe("cache")
    expect(JSON.parse(result.stdout).description).toContain("三年经验")
    const miss = await cli(["detail", "missing_job", "--cached-only", "--data-dir", dir])
    expect(JSON.parse(miss.stderr).code).toBe("CACHE_MISS")
    await writeFile(join(dir, "jobs", ID + ".json"), "{broken")
    expect(JSON.parse((await cli(["detail", ID, "--cached-only", "--data-dir", dir])).stderr).code).toBe("BAD_CACHE")
  } finally { await rm(dir, { recursive: true, force: true }) }
})
