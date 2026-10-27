import { mkdir, chmod, open, readFile, rename, unlink } from "node:fs/promises"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { PortalError, jobAddress, requireComplete, type Job, type Portal } from "./model.js"
declare const CHINA_SOURCE_DATA_DIR: string | undefined
export const DEFAULT_DATA_DIR = typeof CHINA_SOURCE_DATA_DIR === "string" ? CHINA_SOURCE_DATA_DIR
  : fileURLToPath(new URL("../../job_scraper/china-portals/", import.meta.url))
export class Store {
  readonly root: string
  constructor(readonly portal: Portal, root = DEFAULT_DATA_DIR) { this.root = resolve(root) }
  get nativeProfile(): string { return join(this.root, "native-profile") }
  get nativeSession(): string { return join(this.root, "native-session.json") }
  async init(): Promise<void> {
    for (const path of [this.root, this.nativeProfile, join(this.root, "jobs", this.portal)]) {
      await mkdir(path, { recursive: true, mode: 0o700 })
      if (process.platform !== "win32") await chmod(path, 0o700)
    }
  }
  private path(id: string): string { return join(this.root, "jobs", this.portal, jobAddress(this.portal, id).id + ".json") }
  async get(id: string): Promise<Job | null> {
    try { return requireComplete(JSON.parse(await readFile(this.path(id), "utf8")), this.portal, id) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      if (error instanceof SyntaxError) throw new PortalError("BAD_CACHE", "Invalid snapshot JSON; capture this posting again")
      throw error
    }
  }
  async put(job: Job): Promise<void> {
    requireComplete(job, this.portal); await this.init()
    const target = this.path(job.id), temporary = target + "." + process.pid + "." + crypto.randomUUID() + ".tmp"
    const file = await open(temporary, "wx", 0o600)
    try { await file.writeFile(JSON.stringify(job, null, 2) + "\n"); await file.close(); await rename(temporary, target) }
    finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}) }
  }
  async lock(): Promise<() => Promise<void>> {
    await this.init(); const path = join(this.root, "browser.lock")
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(path, "wx", 0o600); await file.writeFile(String(process.pid)); await file.close()
        return async () => { await unlink(path).catch(() => {}) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const pid = Number(await readFile(path, "utf8").catch(() => ""))
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ESRCH") { await unlink(path); continue }
          }
        }
        throw new PortalError("SESSION_BUSY", "Another China portal command owns this browser; run browser commands sequentially")
      }
    }
    throw new PortalError("SESSION_BUSY", "Could not acquire the shared browser session")
  }
}
