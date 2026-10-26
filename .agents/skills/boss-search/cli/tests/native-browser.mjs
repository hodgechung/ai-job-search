// Runs in Node: Bun 1.3's CDP WebSocket transport does not complete its handshake.
// All browser requests are synthetic. Never run this harness against a user profile.
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
const root = process.argv[2]
const origin = "https://www.zhipin.com"
const session = JSON.parse(await readFile(join(root, "native-session.json"), "utf8"))
const version = await (await fetch("http://127.0.0.1:" + session.port + "/json/version")).json()
const browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl, { noDefaults: true, timeout: 5000 })
async function cli(args) {
  const child = spawn(process.argv[3], ["run", fileURLToPath(new URL("../src/cli.ts", import.meta.url)), ...args, "--data-dir", root], { stdio: ["ignore", "pipe", "pipe"] })
  let stdout = "", stderr = ""
  child.stdout.on("data", chunk => { stdout += chunk })
  child.stderr.on("data", chunk => { stderr += chunk })
  const timer = setTimeout(() => child.kill(), 12000)
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve) })
  clearTimeout(timer)
  return { code, stdout, stderr }
}
try {
  const context = browser.contexts()[0]
  const requests = []
  await context.route("**/*", async route => {
    const url = new URL(route.request().url())
    requests.push(url.origin + url.pathname)
    if (url.origin !== origin) { await route.abort(); return }
    await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<html><body><a href="/web/user/">登录</a>扫码登录</body></html>' })
  })
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(origin + "/")
  const before = requests.length
  const reused = await cli(["login"])
  assert.equal(reused.code, 0, reused.stderr)
  assert.equal(JSON.parse(reused.stdout).reused, true)
  assert.equal(requests.length, before, "login must not open/reload an existing window")
  const status = await cli(["status"])
  assert.equal(status.code, 0, status.stderr)
  assert.equal(status.stderr, "")
  assert.deepEqual(JSON.parse(status.stdout), { status: "login_required", authenticated: false })
  assert.equal(requests.length, before, "status must not navigate")
  assert.equal(page.isClosed(), false, "status must leave the window open")
  const failed = await cli(["detail", "fixture_missing_123", "--refresh", "--no-wait"])
  assert.equal(failed.code, 1)
  assert.equal(JSON.parse(failed.stderr).code, "LOGIN_REQUIRED", failed.stderr)
  assert.equal(requests.length, before, "failed command must not navigate during sign-in")
  assert.equal(page.isClosed(), false, "failed command must leave the window open")
  assert.deepEqual(requests, [origin + "/"])
  await fetch("http://127.0.0.1:" + session.port + "/json/version")
  console.log(JSON.stringify({ passed: true, checks: ["login_reuse", "observe_only_status", "no_navigation", "window_survives_success", "window_survives_failure"] }))
} finally { await browser.close() }
