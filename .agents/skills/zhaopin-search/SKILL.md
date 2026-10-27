---
name: zhaopin-search
version: 0.1.0
description: >-
  Search 智联招聘 (zhaopin) jobs in China and read complete posting snapshots.
  Use for 智联招聘岗位搜索、智联招聘职位详情. Public search and detail use
  anonymous HTML without login; a local Chrome browser is optional for inspection.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/zhaopin-search/cli/src/cli.ts *)
---

# 智联招聘只读搜索

Live Hangzhou Java search, full-description capture and cached-only retrieval
verified on 2026-10-27 without prior login. Enabled for /scrape discovery. Never
present fixtures, login walls, default recommendations or truncated JDs as results.

## Usage

Requires Bun and `bun install` in this skill's cli folder (or the repository's
`python3 tools/install_portal_clis.py`). Optional browser inspection also requires
Node.js 20+ and Google Chrome.

~~~bash
bun run .agents/skills/zhaopin-search/cli/src/cli.ts search -q "Java 后端" -l "杭州" --limit 3 --no-wait --format json
bun run .agents/skills/zhaopin-search/cli/src/cli.ts detail ID_FROM_SEARCH --cached-only --format plain
bun run .agents/skills/zhaopin-search/cli/src/cli.ts detail POSTING_URL --refresh --format json
~~~

`ID_FROM_SEARCH` and `POSTING_URL` are placeholders. Use an actual search result.
Supported cities: 杭州（已核对城市编码 653）；其他城市目前请使用智联三位城市编码，未知城市名会报错.

Search accepts -q/--query, -l/--location, -n/--limit (1–20, default 3), --page 1,
and --format json|table|plain. Detail accepts an ID or HTTPS posting URL and
--format json|plain; --cached-only never opens a browser; --refresh fetches fresh public HTML.
No publication-date filter; dates stay null when unverified. HR activity, refresh
and snapshot times are not posting dates. `--timeout` (10–60, default 20 seconds)
controls content loading. Authentication gates always return immediately;
--no-wait is accepted for batch-workflow compatibility.

## Public HTML and optional browser handoff

Search and detail use public HTML requests with no Cookie or account credentials.
No browser or prior login is required for these commands. The server supplies the
full description even when the page folds its display. Preserve any actual
redactions; do not infer masked fields. `open` is optional for manual inspection.

The three new China portals share one dedicated profile and browser lock in
ignored job_scraper/china-portals/. BOSS retains its own separate profile.
Run browser commands sequentially. `open` launches ordinary Chrome once and returns
browser_ready immediately, without refreshing or polling the page. `login` remains
available for explicit manual authentication when the site requests it.
An existing window is reused; manually open this portal there if needed.
Only `status` connects Playwright through loopback CDP using Node for browser
inspection; search/detail use anonymous HTML. Completion disconnects without
closing the external window.
Status reports visible gates; no_gate_detected is not proof of authentication.

On LOGIN_REQUIRED or VERIFICATION_REQUIRED, preserve the current page and ask the
user to finish there. No retry, refresh, alternative route or health probe around
the gate. Do not solve CAPTCHAs. Refuse missing/truncated server descriptions;
a CSS display fold alone does not prove a login wall.
SESSION_BUSY prevents concurrent browser access. Never copy the user's personal
browser cookies/profile. --data-dir overrides all private session/cache storage.

## Personal use and workflow

For the user's authorized personal job search only. The sites restrict automated
access/republication; keep volume low, do not bulk collect or redistribute jobs,
and do not bypass access controls. This adapter does not send messages, submit
applications, upload resumes or change account/profile information.

Search saves complete JDs and may reuse snapshots younger than 24 hours. Report
the capture time; it is not a live availability check. Batch /scrape uses --no-wait
and tags portal: zhaopin-search, source: cli. /rank and /apply should read
`detail --cached-only` and pass the text through tools/posting_guard.py. On
CACHE_MISS the parent captures the JD; parallel scoring/fetching agents must not
start login browsers. Errors are JSON on stderr, exit 1; stdout contains results.

See [url-reference.md](url-reference.md) for observed routes and parsing anchors.
