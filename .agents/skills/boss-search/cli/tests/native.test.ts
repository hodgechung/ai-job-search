import { test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { validateSession, validateEndpoint, openNativeLogin, nativeEndpoint, readNativeSession } from "../src/native.js"
import { withBrowser } from "../src/browser.js"
import { ORIGIN } from "../src/helpers.js"
import { Store } from "../src/store.js"

test("native session accepts only its own private profile and valid process/port metadata", () => {
  const profile = "/tmp/boss-test/native-profile"
  expect(validateSession({ pid: process.pid, port: 9222, profile, createdAt: "2026-10-22" }, profile).port).toBe(9222)
  for (const bad of [{ pid: -1, port: 9222, profile }, { pid: 1, port: 80, profile },
    { pid: 1, port: 9222, profile: "/Users/someone/default-profile" }]) {
    expect(() => validateSession({ createdAt: "2026-10-22", ...bad }, profile)).toThrow()
  }
})
test("CDP connections cannot point off-machine, to another port or to an arbitrary path", () => {
  const valid = "ws://127.0.0.1:9222/devtools/browser/abcdef-123"
  expect(validateEndpoint({ webSocketDebuggerUrl: valid }, 9222)).toBe(valid)
  for (const bad of ["ws://evil.test:9222/devtools/browser/abcdef", "ws://127.0.0.1:9223/devtools/browser/abcdef",
    "ws://user@127.0.0.1:9222/devtools/browser/abcdef", "ws://127.0.0.1:9222/other",
    "ws://127.0.0.1:9222/devtools/browser/abcdef?token=x"]) {
    expect(() => validateEndpoint({ webSocketDebuggerUrl: bad }, 9222)).toThrow()
  }
})
const browserTest = process.env.BOSS_BROWSER_TESTS === "1" ? test : test.skip
browserTest("native login handoff reuses its window; CLI status only observes and disconnects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boss-native-"))
  const store = new Store(dir)
  let child: ChildProcess | undefined
  try {
    const opened = await openNativeLogin(store, "chrome", (executable, args) => {
      // Product code opens BOSS for manual sign-in. This test opens about:blank
      // headlessly instead; fixture routes are installed before any site URL.
      expect(args.some(a => a.includes("enable-automation"))).toBe(false)
      expect(args.some(a => a.includes("disable-blink-features"))).toBe(false)
      expect(args).toContain("--remote-debugging-address=127.0.0.1")
      expect(args.at(-1)).toBe(ORIGIN + "/web/user/?ka=header-login")
      child = spawn(executable, ["--headless=new", "--no-first-run", ...args.slice(0, -1), "about:blank"],
        { detached: true, stdio: "ignore" })
      child.unref()
      return child
    })
    expect(opened.status).toBe("manual_login")
    expect(opened.reused).toBe(false)
    const session = await readNativeSession(store)
    expect(session).not.toBeNull()
    const endpoint = await nativeEndpoint(session!)
    expect(endpoint).toStartWith("ws://127.0.0.1:")
    const probe = Bun.spawn(["node", join(import.meta.dir, "native-browser.mjs"), dir, process.execPath], { stdout: "pipe", stderr: "pipe" })
    const timer = setTimeout(() => probe.kill(), 20000)
    const [stdout, stderr, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited])
    clearTimeout(timer)
    expect(code, stderr).toBe(0)
    expect(stderr).toBe("")
    expect(JSON.parse(stdout).passed).toBe(true)
    expect(JSON.parse(stdout).checks).toContain("window_survives_failure")

  } finally {
    if (child?.pid) child.kill("SIGTERM")
    if (child && child.exitCode === null) await new Promise(resolve => { child!.once("exit", resolve); setTimeout(resolve, 3000) })
    await rm(dir, { recursive: true, force: true })
  }
}, 30000)
test("an absent native browser does not automatically open another login window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "boss-no-browser-"))
  try {
    await expect(withBrowser(new Store(dir), { wait: false, timeout: 10, browser: "chrome" },
      client => client.login())).rejects.toHaveProperty("code", "LOGIN_REQUIRED")
  } finally { await rm(dir, { recursive: true, force: true }) }
})
