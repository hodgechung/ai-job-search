import { test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromium, type BrowserContext } from "playwright"
import { BossBrowser, LIST_PATH, DETAIL_PATH } from "../src/browser.js"
import { Store } from "../src/store.js"
import { ORIGIN } from "../src/helpers.js"

// Synthetic pages/responses only. This suite must never reach a recruitment site.
// Opt in locally: BOSS_BROWSER_TESTS=1 bun test (uses installed Chrome, no personal profile).
const browserTest = process.env.BOSS_BROWSER_TESTS === "1" ? test : test.skip
const ID = "browser_fixture_123"
const payload = { code: 0, zpData: { jobInfo: { encryptId: ID, jobName: "合成测试岗位",
  postDescription: "完整的合成测试 JD", locationName: "上海", jobStatusDesc: "招聘中" },
  brandComInfo: { brandName: "合成测试公司" } } }
async function fixture(run: (client: BossBrowser, context: BrowserContext, requests: string[], store: Store) => Promise<void>, loggedIn = true) {
  const dir = await mkdtemp(join(tmpdir(), "boss-browser-"))
  const browser = await chromium.launch({ channel: "chrome", headless: true })
  const context = await browser.newContext()
  const requests: string[] = []
  try {
    if (loggedIn) await context.addCookies([{ name: "fixture_auth", value: "valid", domain: "www.zhipin.com", path: "/" }])
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url())
      requests.push(request.method() + " " + url.origin + url.pathname)
      if (url.origin !== ORIGIN) { await route.abort(); return }
      if (url.pathname === LIST_PATH) {
        await route.fulfill({ json: { code: 0, zpData: { jobList: [{ encryptJobId: ID, jobName: "合成测试岗位", brandName: "合成测试公司" }] } } }); return
      }
      if (url.pathname === DETAIL_PATH) { await route.fulfill({ json: payload }); return }
      const auth = request.headers().cookie?.includes("fixture_auth=valid")
      let body = auth ? '<ul><li class="nav-figure">测试用户</li></ul>' : '<a href="/web/user/">登录</a>'
      if (url.pathname === "/web/user/") {
        body = '扫码登录<script>setTimeout(()=>{document.cookie="fixture_auth=valid;path=/";location.href="/web/geek/job"},250)</script>'
      } else if (auth && url.pathname.startsWith("/job_detail/")) {
        body += '<script>fetch("' + DETAIL_PATH + '?jobId=' + ID + '")</script>'
      } else if (auth && url.searchParams.has("query")) {
        body += '<script>fetch("' + LIST_PATH + '")</script>'
        body += '<ul><li class="job-card-box" onclick="event.preventDefault();fetch(\'' + DETAIL_PATH + '\')"><a class="job-name" href="/job_detail/' + ID + '.html">合成测试岗位</a></li></ul>'
      }
      body += '<button onclick="fetch(\'/fixture-send-message\',{method:\'POST\'})">立即沟通</button>'
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: "<html><body>" + body + "</body></html>" })
    })
    const store = new Store(join(dir, "data")); await store.init()
    const page = await context.newPage()
    await page.goto(ORIGIN + "/")
    const client = new BossBrowser(page, store, { wait: false, timeout: 10, browser: "chrome" })
    await run(client, context, requests, store)
    expect(requests.every(r => r.startsWith("GET " + ORIGIN))).toBe(true)
    expect(requests.some(r => r.includes("fixture-send-message"))).toBe(false)
  } finally { await context.close(); await browser.close(); await rm(dir, { recursive: true, force: true }) }
}
browserTest("browser search captures JSON and persists a complete JD without clicking communication", async () => {
  await fixture(async (client, context, requests, store) => {
    await client.login()
    // Model another tab becoming active between commands. Searching must still
    // load and capture full details from the existing BOSS tab.
    const other = await context.newPage()
    await other.goto("about:blank")
    await other.bringToFront()
    const jobs = await client.search("Python", "上海", 1, 1)
    expect(jobs).toHaveLength(1); expect(jobs[0].description).toBe("完整的合成测试 JD")
    expect((await store.get(ID))?.description).toBe("完整的合成测试 JD")
    expect(requests.some(r => r.includes(DETAIL_PATH))).toBe(true)
    expect(requests.some(r => r.includes("/job_detail/"))).toBe(false)
  })
})
browserTest("expired login returns LOGIN_REQUIRED when waiting is disabled", async () => {
  await fixture(async client => { await expect(client.login()).rejects.toHaveProperty("code", "LOGIN_REQUIRED") }, false)
})
browserTest("login waits for the browser to authenticate, then continues without stdin", async () => {
  await fixture(async (client, context, requests) => {
    const interactive = new BossBrowser(client.page, client.store, { wait: true, timeout: 10, browser: "chrome" })
    const waiting = interactive.login()
    // Test code models the user's own click; the adapter only observes.
    await client.page.getByRole("link", { name: "登录", exact: true }).click()
    await waiting
    expect(await interactive.state()).toBe("authenticated")
    // Only the site's synthetic login redirect navigates after the QR handoff.
    expect(requests.filter(r => r === "GET " + ORIGIN + "/")).toHaveLength(1)
    expect(requests.filter(r => r === "GET " + ORIGIN + "/web/user/")).toHaveLength(1)
    expect(requests.filter(r => r === "GET " + ORIGIN + "/web/geek/job")).toHaveLength(1)
  }, false)
})
browserTest("403 and 429 do not turn into QR login attempts", async () => {
  await fixture(async (client, context) => {
    await context.route(ORIGIN + "/denied", route => route.fulfill({ status: 403, body: "denied" }))
    await expect(client.navigate(ORIGIN + "/denied")).rejects.toHaveProperty("code", "ACCESS_DENIED")
    await context.route(ORIGIN + "/limited", route => route.fulfill({ status: 429, body: "limited" }))
    await expect(client.navigate(ORIGIN + "/limited")).rejects.toHaveProperty("code", "RATE_LIMITED")
  })
})
