import { BossError, normalizeId } from "../helpers.js"
import { Store } from "../store.js"
import { withBrowser, type BrowserOptions } from "../browser.js"

/** Parallel rank/apply agents can read snapshots without acquiring the browser. */
export async function getDetail(store: Store, options: BrowserOptions, input: string, refresh: boolean, cachedOnly: boolean) {
  if (refresh && cachedOnly) throw new BossError("BAD_ARG", "--refresh conflicts with --cached-only")
  const id = normalizeId(input)
  const cached = refresh ? null : await store.get(id)
  if (!cached && cachedOnly) throw new BossError("CACHE_MISS", "No complete snapshot; run search or detail without --cached-only")
  const job = cached ?? await withBrowser(store, options, async client => { await client.login(); return client.detail(id) })
  return { job, source: cached ? "cache" : "browser" }
}
