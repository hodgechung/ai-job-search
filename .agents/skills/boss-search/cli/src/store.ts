import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { BossError, normalizeId, type Job } from "./helpers.js"
declare const BOSS_SOURCE_DATA_DIR: string | undefined
export const DEFAULT_DATA_DIR = typeof BOSS_SOURCE_DATA_DIR === "string" ? BOSS_SOURCE_DATA_DIR
  : fileURLToPath(new URL("../../../../../job_scraper/boss/", import.meta.url))

export class Store {
  readonly root: string
  constructor(root = DEFAULT_DATA_DIR) { this.root = resolve(root) }
  get profile(): string { return join(this.root, "profile") }
  get nativeProfile(): string { return join(this.root, "native-profile") }
  get nativeSession(): string { return join(this.root, "native-session.json") }
  async init(): Promise<void> {
    for (const dir of [this.root, join(this.root, "jobs"), this.profile, this.nativeProfile]) {
      await mkdir(dir, { recursive: true, mode: 0o700 })
      if (process.platform !== "win32") await chmod(dir, 0o700)
    }
  }
  private path(id: string): string { return join(this.root, "jobs", normalizeId(id) + ".json") }
  async get(id: string): Promise<Job | null> {
    try {
      const job = JSON.parse(await readFile(this.path(id), "utf8")) as Job
      if (job.id !== id || !job.title || !job.company || !job.description || !Number.isFinite(Date.parse(job.fetchedAt))) {
        throw new BossError("BAD_CACHE", "Invalid BOSS snapshot; run detail --refresh")
      }
      return job
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      if (error instanceof SyntaxError) throw new BossError("BAD_CACHE", "Invalid BOSS snapshot JSON; run detail --refresh")
      throw error
    }
  }
  async put(job: Job): Promise<void> {
    await this.init()
    const target = this.path(job.id)
    const tmp = target + "." + process.pid + "." + crypto.randomUUID() + ".tmp"
    try {
      const file = await open(tmp, "wx", 0o600)
      try { await file.writeFile(JSON.stringify(job, null, 2) + "\n") } finally { await file.close() }
      await rename(tmp, target)
    } finally { await unlink(tmp).catch(() => {}) }
  }
  async lock(): Promise<() => Promise<void>> {
    await this.init()
    const path = join(this.root, "browser.lock")
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(path, "wx", 0o600)
        await file.writeFile(String(process.pid))
        await file.close()
        return async () => { await unlink(path).catch(() => {}) }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        const pid = Number(await readFile(path, "utf8").catch(() => ""))
        if (Number.isInteger(pid) && pid > 0) {
          try { process.kill(pid, 0) } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ESRCH") { await unlink(path).catch(() => {}); continue }
          }
        }
        throw new BossError("SESSION_BUSY", "Another BOSS command owns the browser profile; run browser commands sequentially")
      }
    }
    throw new BossError("SESSION_BUSY", "Could not acquire BOSS browser profile")
  }
}
