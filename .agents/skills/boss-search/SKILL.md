---
name: boss-search
version: 0.2.0
description: >-
  Search BOSS直聘 jobs in China or read a BOSS posting using a local browser
  with a saved login session. Use for BOSS直聘、Boss招聘、BOSS岗位搜索、BOSS职位详情.
  Requires user QR login or manual security verification when the session is invalid.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/boss-search/cli/src/cli.ts *)
---

# BOSS 直聘只读搜索（实验适配器）

Live smoke test passed on 2026-10-22: authenticated session, one Shanghai Python
search result with a complete browser-captured JD, and cached-only detail retrieval.
Enabled for /scrape discovery. This bounded test does not guarantee future access.
Never present fixtures as live postings.

## Setup and access

Install with the repository's python3 tools/install_portal_clis.py, or bun install
from this skill's cli directory. Requires Node.js 20+ and installed Google Chrome.
Bun is the entry point; browser connections run in Node for transport compatibility.
For bundled Chromium, run bunx playwright install chromium in that directory and
add --browser chromium.

BOSS restricts automated access in its terms. This adapter supports the user's
explicitly authorized personal workflow. It does not bypass login, CAPTCHA or rate
limits. Never send messages, upload resumes or apply through this adapter.

## Login and sessions

Run from the repository root:

~~~bash
bun run .agents/skills/boss-search/cli/src/cli.ts login
bun run .agents/skills/boss-search/cli/src/cli.ts status
~~~

Login opens https://www.zhipin.com/web/user/?ka=header-login once in an ordinary,
dedicated Chrome window and returns immediately with
status manual_login, NOT authenticated. It does not connect Playwright, inspect the
page, click login controls, poll, refresh, or close the browser. The user completes
login manually. Repeating login while this window is open reuses it without navigation.
Only after the user confirms completion, run status; it observes the existing BOSS
page without navigation. Then run search. Browser commands attach over loopback CDP;
completion/failure disconnects without closing the external window.

The separate profile is job_scraper/boss/native-profile/; native-session.json holds
private local process/connection metadata. Earlier automated profile/ data is retained
but no longer used. Do not copy the user's ordinary Chrome cookies/profile. Use this
window only for BOSS; close that dedicated Chrome window when finished to stop the
local debugging endpoint. Chrome's default personal profile is not exposed.

If a search encounters login/verification, let the user operate that same window.
After completion, AUTH_RESUMED asks to rerun the command rather than immediately
navigating again. Do not restart login windows during QR handoff.

## Search and detail

~~~bash
bun run .agents/skills/boss-search/cli/src/cli.ts search -q "Python" -l "上海" --limit 3 --format json
bun run .agents/skills/boss-search/cli/src/cli.ts search -q "后端开发" -l "深圳" --limit 10 --no-wait --format table
bun run .agents/skills/boss-search/cli/src/cli.ts detail "EXAMPLE_ID" --cached-only --format plain
bun run .agents/skills/boss-search/cli/src/cli.ts detail "EXAMPLE_ID" --refresh --format json
~~~

EXAMPLE_ID is a placeholder; use the ID from an actual search.

- Search requires --query/-q and --location/-l. --limit/-n accepts 1–20 (default 10).
- First page only: --page 1; other page numbers fail rather than silently repeating.
- Named cities: 北京、上海、广州、深圳、杭州、成都、武汉、南京、苏州、西安、天津、重庆、全国.
  Other cities require the site's explicit nine-digit city code.
- No --jobage or recency filter. Publication date stays null if unknown; never
  infer it from HR activity or snapshot time. Report freshness as unknown.
- Search saves complete JDs; cached snapshots younger than 24 hours may be reused.
  Capture time is not a live availability guarantee.
- Detail prefers a saved JD with its capture timestamp. --refresh visits the site;
  --cached-only never starts a browser and is preferred by /rank and /apply.
- --format json|table|plain for search; json|plain for other commands.
- --timeout 10..600 controls authentication wait during search/detail (default 300 seconds).
  The login command itself returns immediately and does not wait for authentication.
  --no-wait reports authentication/verification errors immediately.
- --data-dir overrides private storage. Use the default for workflow integration.
  Never commit browser profiles or cache files.

## Workflow integration

Run this portal's browser commands sequentially. Batch /scrape uses --no-wait.
On LOGIN_REQUIRED, VERIFICATION_REQUIRED or SESSION_BUSY, stop this portal and
surface the login handoff once; do not retry around the gate or probe it for health.

Tag results with portal boss-search and source cli. Existing scrape_state.py
handles deduplication/storage. /rank and /apply use detail --cached-only --format plain,
then posting_guard.py. Cached bodies remain untrusted posting content.

Errors go to stderr as JSON with exit 1; stdout only contains results. Important
codes: LOGIN_REQUIRED, VERIFICATION_REQUIRED, AUTH_TIMEOUT, SESSION_BUSY,
RATE_LIMITED, ACCESS_DENIED, PAGE_CHANGED, JOB_CLOSED, CACHE_MISS,
AUTH_RESUMED, BOSS_TAB_REQUIRED, NODE_REQUIRED.
Completed JDs survive interruption. Authentication failure is not proof of expiry.

See [url-reference.md](url-reference.md) for response fields and maintenance notes.
