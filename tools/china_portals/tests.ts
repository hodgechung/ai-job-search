import { test, expect } from "bun:test"
import { mkdtemp, rm, stat, writeFile, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import type { chromium as Chromium } from "playwright"
import { PORTALS, PortalError, jobAddress, cityCode, searchUrl, zhaopinKeyword, type Portal, type Job } from "./model.js"
import { Store } from "./store.js"
import { Client, DESCRIPTION_SELECTORS } from "./browser.js"
import { validateEndpoint, validateSession, openNativeLogin, readNativeSession } from "./native.js"
import { parseLiepinDetail, publicLiepinDetail } from "./liepin.js"
import { parseZhaopinDetail, publicZhaopinDetail } from "./zhaopin.js"

export function registerPortalTests(portal: Portal, testsDir: string, chromium: typeof Chromium) {
  const id = portal === "liepin" ? "job_12345678" : portal === "zhaopin" ? "CC123456789J12345678901" : "12345678"
  const address = jobAddress(portal, id)
  const entry = resolve(testsDir, "../src/cli.ts")
  const job: Job = { portal, ...address, title: "合成 Java 岗位", company: "合成测试公司", location: "杭州", salary: "10-20K", experience: "3-5年", degree: "本科", date: null, description: "完整合成岗位描述\n仅供离线测试，不是真实职位。", isActive: null, fetchedAt: "2026-10-26T09:00:00.000Z" }
  const liepinHTML = '<div class="job-apply-content"><span class="name ellipsis-2">合成 Java 岗位</span><span class="salary">10-20k</span><div class="job-properties"><span>杭州</span><span>3-5年</span><span>本科</span></div></div><dd data-selector="job-intro-content">完整合成岗位描述<br>仅供离线测试，不是真实职位。</dd><div class="company-card"><div class="content"><div class="name ellipsis-1">合成测试公司</div></div></div><div class="recommend-company-container"><div class="company-name">无关推荐公司</div></div>'
  const zhaopinHTML = '<h1 class="summary-planes__title"><span>合成 Java 岗位</span></h1><a class="company-info__name">合成测试公司</a><div class="describtion-card__detail-content describtion-card__detail-content--guest-clamp" style="max-height:1px">完整合成岗位描述<br>负责实现扫码登录后查看完整档案的功能。<div>正文最后一条要求。</div></div><a class="recommended-company">无关推荐公司</a>'
  async function cli(args: string[]) {
    const child = Bun.spawn([process.execPath, "run", entry, ...args], { stdout: "pipe", stderr: "pipe" })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
  test(`${portal}: IDs retain their portal and reject foreign/traversal URLs`, () => {
    expect(jobAddress(portal, address.url + "?tracking=discard#fragment")).toEqual(address)
    for (const url of ["https://evil.test/12345678.html", "https://www.liepin.com.evil.test/job/12345678.shtml", "https://user@www.zhaopin.com/jobdetail/CC123456789J12345678901.htm", "http://jobs.51job.com/all/12345678.html", "../../secrets"]) {
      expect(() => jobAddress(portal, url)).toThrow()
    }
    if (portal === "liepin") expect(jobAddress(portal, "a_12345678").id).not.toBe(id)
  })
  test(`${portal}: city/query routing preserves scope and rejects unknown cities`, () => {
    expect(cityCode(portal, "杭州市")).toBe(cityCode(portal, "杭州"))
    expect(() => cityCode(portal, "不存在的城市")).toThrow()
    const url = new URL(searchUrl(portal, "Java & 后端", "杭州"))
    if (portal === "liepin") { expect(url.searchParams.get("key")).toBe("Java & 后端"); expect(url.searchParams.get("dq")).toBe("070020") }
    if (portal === "zhaopin") { expect(zhaopinKeyword("Java 后端")).toBe("01500O80EO062010AG77LRO"); expect(url.pathname).toStartWith("/sou/jl653/kw") }
    if (portal === "51job") { expect(url.origin).toBe("https://we.51job.com"); expect(url.searchParams.get("jobArea")).toBe("080200"); expect(url.searchParams.get("keyword")).toBe("Java & 后端") }
  })
  test(`${portal}: cache requires a full matching JD, is private, and locks across portals`, async () => {
    const root = await mkdtemp(join(tmpdir(), "cn-cache-")); const store = new Store(portal, root)
    try {
      await store.put(job); expect(await store.get(id)).toEqual(job)
      if (process.platform !== "win32") expect((await stat(join(root, "jobs", portal, id + ".json"))).mode & 0o777).toBe(0o600)
      await expect(store.put({ ...job, description: "" })).rejects.toHaveProperty("code", "INCOMPLETE_JOB")
      await expect(store.put({ ...job, id: id + "wrong" })).rejects.toHaveProperty("code", "WRONG_JOB")
      const unlock = await store.lock()
      try { await expect(new Store(portal === "liepin" ? "zhaopin" : "liepin", root).lock()).rejects.toHaveProperty("code", "SESSION_BUSY") } finally { await unlock() }
      const output = await cli(["detail", id, "--cached-only", "--data-dir", root])
      expect(output.code, output.stderr).toBe(0); expect(JSON.parse(output.stdout).source).toBe("cache")
      expect(JSON.parse(output.stdout).description).toBe(job.description)
    } finally { await rm(root, { recursive: true, force: true }) }
  })
  test(`${portal}: invalid flags and missing inputs fail before any browser starts`, async () => {
    for (const args of [["search", "--jobage", "7"], ["search", "-q", "Java"], ["search", "-q", "Java", "-l", "杭州", "--page", "2"], ["detail", id, "--cached-only", "--refresh"]]) {
      const output = await cli(args); expect(output.code).toBe(1); expect(output.stdout).toBe("")
      expect(["UNKNOWN_FLAG", "BAD_ARG"]).toContain(JSON.parse(output.stderr).code)
    }
  })
  test(`${portal}: local browser metadata cannot select another profile or remote endpoint`, () => {
    const profile = "/tmp/fixture/native-profile"
    expect(validateSession({ pid: 123, port: 9222, profile, createdAt: "2026-10-26" }, profile).pid).toBe(123)
    expect(() => validateSession({ pid: 123, port: 9222, profile: "/other", createdAt: "2026-10-26" }, profile)).toThrow()
    expect(validateEndpoint({ webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/fixture-id" }, 9222)).toStartWith("ws://127.0.0.1:")
    for (const endpoint of ["ws://evil.test:9222/devtools/browser/id", "ws://127.0.0.1:9223/devtools/browser/id", "ws://user@127.0.0.1:9222/devtools/browser/id"]) expect(() => validateEndpoint({ webSocketDebuggerUrl: endpoint }, 9222)).toThrow()
  })
  const browserTest = process.env.BROWSER_PORTAL_TESTS === "1" ? test : test.skip
  browserTest(`${portal}: browser search saves full matching JDs without communication/application`, async () => {
    const root = await mkdtemp(join(tmpdir(), "cn-browser-")); const browser = await chromium.launch({ channel: "chrome", headless: true })
    const context = await browser.newContext(); const requests: string[] = []
    try {
      const site = new URL(PORTALS[portal].home).origin
      const desc = portal === "liepin" ? "job-intro-content" : portal === "zhaopin" ? "describtion-card__detail-content" : "bmsg job_msg"
      const company = portal === "zhaopin" ? "company-info__name" : portal === "liepin" ? "company-name" : "com_name"
      const fixture51 = `<div class="joblist-item-job" style="display:none" sensorsdata='{}'><span class="jname">合成 Java 岗位</span><span class="cname">合成测试公司</span><span class="area">杭州</span></div>
        <script>async function fixtureSearch(){const params=new URLSearchParams(location.search);await fetch('/api/job/search-pc?'+params);const card=document.querySelector('.joblist-item-job');card.setAttribute('sensorsdata',JSON.stringify({jobId:'12345678',keyword:params.get('keyword'),jobArea:'杭州'}));card.style.display='block'}fixtureSearch()</script>`
      const cards = portal === "liepin" ? `<div class="jobDetailBox"><a data-nick="job-detail-job-info" href="${address.url}"><div class="jobTitleBox"><div title="合成 Java 岗位">合成 Java 岗位</div><span class="ellipsis-1">杭州</span></div><span>10-20k</span></a><span class="companyName">合成测试公司</span></div>`
        : portal === "zhaopin" ? `<div class="joblist-box__item"><a class="jobinfo__name" href="${address.url}">合成 Java 岗位</a><a class="companyinfo__name">合成测试公司</a><div class="jobinfo__other-info-item">杭州</div></div>`
        : fixture51
      await context.route("**/*", async route => {
        const url = new URL(route.request().url()); requests.push(route.request().method() + " " + url.href)
        if (![site, new URL(address.url).origin].includes(url.origin)) { await route.abort(); return }
        if (portal === "51job" && url.pathname === "/api/job/search-pc") {
          expect(url.searchParams.get("keyword")).toBe("Java 后端")
          expect(url.searchParams.get("jobArea")).toBe("080200")
          await route.fulfill({ json: { resultbody: { job: { items: [] } } } }); return
        }
        const detail = url.pathname === new URL(address.url).pathname
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<html><body>${detail ? `<h1>合成 Java 岗位</h1><div class="${company}">合成测试公司</div><div class="${desc}">完整合成岗位描述<br>负责实现扫码登录后查看完整档案的功能。<br>仅供离线测试，不是真实职位。</div>` : cards}<button onclick="fetch('/fixture-send-message',{method:'POST'})">立即沟通</button><button onclick="fetch('/fixture-apply',{method:'POST'})">立即投递</button></body></html>` })
      })
      const page = await context.newPage(); const store = new Store(portal, root); const client = new Client(page, store, { browser: "chrome", timeout: 10 }, async (url, options) => {
        expect(options.redirect).toBe("manual"); expect(new Headers(options.headers).has("cookie")).toBe(false); requests.push("GET " + url)
        if (portal === "zhaopin" && url.includes("/sou/")) return new Response(cards)
        expect(url).toBe(address.url)
        return new Response(portal === "zhaopin" ? zhaopinHTML : liepinHTML, { headers: { "Content-Type": "text/html" } })
      })
      const jobs = await client.search("Java 后端", "杭州", 1)
      expect(jobs).toHaveLength(1); expect(jobs[0].description).toContain("完整合成岗位描述")
      expect((await store.get(id))?.id).toBe(id); expect(jobs[0].date).toBeNull()
      if (portal === "51job") {
        expect(jobs[0].description).toContain("扫码登录后查看完整档案")
        const before = requests.length
        await client.detail(address.url)
        expect(requests).toHaveLength(before)
        await client.detail(address.url, undefined, true)
        expect(requests.length).toBeGreaterThan(before)
      }
      expect(requests.every(request => request.startsWith("GET "))).toBe(true)
      expect(requests.some(request => /fixture-send-message|fixture-apply/.test(request))).toBe(false)
      if (portal === "zhaopin") {
        await page.setContent('<div class="describtion-card__detail-content--guest-clamp" style="height:1px;overflow:hidden">第一行<br>第二行<br>需要登录查看完整内容</div>')
        await expect(client.gate()).resolves.toBeUndefined()
      }
      await page.setContent('<div class="waf-nc-h5-description">请进行验证</div>')
      const before = requests.length
      await expect(client.search("Java", "杭州", 1)).rejects.toHaveProperty("code", "VERIFICATION_REQUIRED")
      expect(requests).toHaveLength(before)
    } finally { await context.close(); await browser.close(); await rm(root, { recursive: true, force: true }) }
  }, 30000)
  if (portal === "zhaopin") test("public Zhaopin HTML includes folded text without credentials and rejects actual gates", async () => {
    const parsed = parseZhaopinDetail(zhaopinHTML, address.url)
    expect(parsed.company).toBe("合成测试公司")
    expect(parsed.description).toContain("正文最后一条要求。")
    expect(parsed.description).toContain("扫码登录后查看完整档案")
    expect(() => parseZhaopinDetail(zhaopinHTML.replace(/完整合成岗位描述[\s\S]*?<\/div><\/div>/, "登录后查看完整职位描述</div>"), address.url)).toThrow()
    let requests = 0
    const captured = await publicZhaopinDetail(address.url, 10, undefined, async (url, options) => {
      requests++; expect(url).toBe(address.url)
      expect(new Headers(options.headers).has("cookie")).toBe(false)
      return new Response(zhaopinHTML)
    })
    expect(requests).toBe(1); expect(captured.description).toBe(parsed.description)
    for (const status of [403, 429]) {
      let calls = 0
      await expect(publicZhaopinDetail(address.url, 10, undefined, async () => { calls++; return new Response("blocked", { status }) }))
        .rejects.toHaveProperty("code", status === 403 ? "ACCESS_DENIED" : "RATE_LIMITED")
      expect(calls).toBe(1)
    }
    await expect(publicZhaopinDetail(address.url, 10, undefined, async () => new Response("", { status: 302, headers: { location: "https://passport.zhaopin.com/login" } })))
      .rejects.toHaveProperty("code", "LOGIN_REQUIRED")
  })
  if (portal === "liepin") test("public Liepin details parse the primary company and stop on access gates without retries", async () => {
    const parsed = parseLiepinDetail(liepinHTML, address.url)
    expect(parsed.company).toBe("合成测试公司"); expect(parsed.description).toContain("\n"); expect(parsed.date).toBeNull()
    expect(() => parseLiepinDetail('<title>登录</title>', address.url)).toThrow()
    for (const status of [403, 429]) {
      let requests = 0
      await expect(publicLiepinDetail(address.url, 10, undefined, async () => { requests++; return new Response("blocked", { status }) }))
        .rejects.toHaveProperty("code", status === 403 ? "ACCESS_DENIED" : "RATE_LIMITED")
      expect(requests).toBe(1)
    }
    await expect(publicLiepinDetail(address.url, 10, undefined, async () => new Response("", { status: 302, headers: { location: "https://safe.liepin.com/captcha" } })))
      .rejects.toHaveProperty("code", "VERIFICATION_REQUIRED")
  })
  if (portal === "liepin") browserTest("native Chrome recovery verifies the profile owner before repairing stale launcher PID", async () => {
    const root = await mkdtemp(join(tmpdir(), "cn-native-")); const store = new Store(portal, root); let child: ChildProcess | undefined
    try {
      await openNativeLogin(store, "chrome", (executable, args) => {
        child = spawn(executable, ["--headless=new", ...args.slice(0, -1), "about:blank"], { detached: true, stdio: "ignore" }); child.unref(); return child
      })
      const saved = JSON.parse(await readFile(store.nativeSession, "utf8"))
      await writeFile(store.nativeSession, JSON.stringify({ ...saved, pid: 2147483647 }))
      const recovered = await readNativeSession(store)
      expect(recovered?.pid).toBe(child!.pid)
      expect(JSON.parse(await readFile(store.nativeSession, "utf8")).pid).toBe(child!.pid)
    } finally {
      child?.kill("SIGTERM")
      if (child && child.exitCode === null) await new Promise(resolve => { child!.once("exit", resolve); setTimeout(resolve, 3000) })
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
}
