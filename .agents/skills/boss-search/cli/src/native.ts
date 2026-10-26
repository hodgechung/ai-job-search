import { spawn, type ChildProcess } from "node:child_process"
import { access, readFile, writeFile, rename } from "node:fs/promises"
import { createServer } from "node:net"
import { join, delimiter } from "node:path"
import { homedir } from "node:os"
import { BossError, ORIGIN, object } from "./helpers.js"
import { Store } from "./store.js"

export interface NativeSession { pid: number; port: number; profile: string; createdAt: string }
export function validateSession(value: unknown, expectedProfile: string): NativeSession {
  const item = object(value)
  if (!Number.isInteger(item.pid) || Number(item.pid) < 1 || !Number.isInteger(item.port)
      || Number(item.port) < 1024 || Number(item.port) > 65535 || item.profile !== expectedProfile
      || typeof item.createdAt !== "string") {
    throw new BossError("BAD_SESSION", "Invalid native browser session; run login to create a dedicated session")
  }
  return item as unknown as NativeSession
}
export function validateEndpoint(value: unknown, port: number): string {
  const endpoint = object(value).webSocketDebuggerUrl
  if (typeof endpoint !== "string") throw new BossError("BAD_SESSION", "Chrome did not expose a browser connection")
  let url: URL
  try { url = new URL(endpoint) } catch { throw new BossError("BAD_SESSION", "Invalid Chrome connection") }
  if (url.protocol !== "ws:" || url.hostname !== "127.0.0.1" || Number(url.port) !== port
      || url.username || url.password || url.search || url.hash || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(url.pathname)) {
    throw new BossError("BAD_SESSION", "Only this adapter's loopback Chrome connection is accepted")
  }
  return endpoint
}
export async function readNativeSession(store: Store): Promise<NativeSession | null> {
  let raw: string
  try { raw = await readFile(store.nativeSession, "utf8") } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
  let session: NativeSession
  try { session = validateSession(JSON.parse(raw), store.nativeProfile) }
  catch { throw new BossError("BAD_SESSION", "Invalid native browser session file; inspect the dedicated profile") }
  try { process.kill(session.pid, 0) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return null
    throw error
  }
  return session
}
export async function nativeEndpoint(session: NativeSession): Promise<string> {
  const response = await fetch("http://127.0.0.1:" + session.port + "/json/version", {
    signal: AbortSignal.timeout(1200), redirect: "error",
  })
  if (!response.ok) throw new BossError("BROWSER_UNAVAILABLE", "Dedicated Chrome connection unavailable; run login")
  return validateEndpoint(await response.json(), session.port)
}
async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") { server.close(); reject(new Error("No loopback port")); return }
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}
async function executable(browser: "chrome" | "chromium"): Promise<string> {
  if (browser === "chromium") {
    const { chromium } = await import("playwright")
    const path = chromium.executablePath()
    try { await access(path); return path } catch { throw new BossError("BROWSER_UNAVAILABLE", "Run bunx playwright install chromium first") }
  }
  const candidates = process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
       join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    : process.platform === "win32"
    ? [join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google/Chrome/Application/chrome.exe"),
       join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
       join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe")]
    : (process.env.PATH ?? "").split(delimiter).flatMap(dir => [join(dir, "google-chrome"), join(dir, "google-chrome-stable")])
  for (const path of candidates) { try { await access(path); return path } catch { /* next installed location */ } }
  throw new BossError("BROWSER_UNAVAILABLE", "Install Google Chrome, or use --browser chromium after installing Chromium")
}

/**
 * Start ordinary Chrome with a dedicated data directory. Do NOT connect Playwright,
 * read page state, click login, navigate or close the window during manual sign-in.
 */
type Launcher = (executable: string, args: string[]) => ChildProcess
const launchDetached: Launcher = (executable, args) => spawn(executable, args, { detached: true, stdio: "ignore" })
export async function openNativeLogin(store: Store, browser: "chrome" | "chromium", launch: Launcher = launchDetached) {
  const unlock = await store.lock()
  try {
    const existing = await readNativeSession(store)
    if (existing) {
      try {
        await nativeEndpoint(existing)
        return { status: "manual_login" as const, reused: true, profile: store.nativeProfile }
      } catch {
        // A live but unreachable process may still own this profile. Do not start
        // another window and disrupt the user's QR code.
        throw new BossError("SESSION_BUSY", "Dedicated Chrome is still open but unreachable; use or close that window first")
      }
    }
    const port = await availablePort()
    const chrome = await executable(browser)
    const child = launch(chrome, [
      "--user-data-dir=" + store.nativeProfile,
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=" + port,
      "--no-first-run",
      "--new-window", ORIGIN + "/web/user/?ka=header-login",
    ])
    let startError = false
    child.on("error", () => { startError = true })
    child.unref()
    if (!child.pid) throw new BossError("BROWSER_UNAVAILABLE", "Could not start dedicated Chrome")
    const session: NativeSession = { pid: child.pid, port, profile: store.nativeProfile, createdAt: new Date().toISOString() }
    const deadline = Date.now() + 10000
    while (Date.now() < deadline && !startError) {
      if (child.exitCode !== null) break
      try {
        await nativeEndpoint(session)
        const temp = store.nativeSession + "." + process.pid + ".tmp"
        await writeFile(temp, JSON.stringify(session) + "\n", { mode: 0o600 })
        await rename(temp, store.nativeSession)
        return { status: "manual_login" as const, reused: false, profile: store.nativeProfile }
      } catch { await new Promise(resolve => setTimeout(resolve, 200)) }
    }
    throw new BossError("BROWSER_UNAVAILABLE", "Chrome did not expose its dedicated connection; inspect the opened window before retrying")
  } finally { await unlock() }
}
