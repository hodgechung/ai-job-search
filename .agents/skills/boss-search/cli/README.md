# BOSS browser CLI

Experimental read-only adapter for ai-job-search. Requires Bun, Playwright and
Google Chrome and Node.js 20+. Uses a dedicated profile, not your regular Chrome login.
Bun commands delegate browser connections to a Node worker.
Does not send messages or submit applications.

## Start from the repository root

~~~bash
python3 tools/install_portal_clis.py
bun run .agents/skills/boss-search/cli/src/cli.ts login
# Complete login in the opened Chrome window, then:
bun run .agents/skills/boss-search/cli/src/cli.ts status
bun run .agents/skills/boss-search/cli/src/cli.ts search -q "Python" -l "上海" --limit 3 --format table
~~~

Login opens https://www.zhipin.com/web/user/?ka=header-login once in ordinary
Chrome and returns status manual_login. It does not
connect Playwright or manipulate the page during QR sign-in. Complete login manually,
then run status; status reads the current BOSS tab without navigating. Repeated login
commands reuse the open window without reopening its page. Search attaches only when
requested, and command completion or errors leave the window open. Search/detail
activate the existing BOSS tab before navigation or card clicks so background-tab
rendering does not stall click stability checks; login/status remain observe-only.

The native-profile/ directory and native-session.json under job_scraper/boss/ contain
private session data; both are ignored by git. The previous profile/ is retained but
no longer used. Use the dedicated window only for BOSS and close that window when done.
Do not restart or expose the user's default Chrome profile for remote debugging.

~~~bash
bun run .agents/skills/boss-search/cli/src/cli.ts status
bun run .agents/skills/boss-search/cli/src/cli.ts detail ID_FROM_SEARCH --cached-only --format plain
~~~

State and complete JDs stay in ignored job_scraper/boss/. Detail prefers snapshots;
--refresh requests a current detail. Capture timestamps are labelled as snapshots.

First page only, max 20 results. No recency filter; unknown date returns null.
Live smoke test passed on 2026-10-22: authenticated session, one Shanghai Python
result with a full browser-captured JD, and cached-only detail retrieval. General
/scrape discovery is enabled. Future access still depends on the saved session
and the site; publication dates remain unknown when not provided.

For bundled Chromium: run bunx playwright install chromium from this CLI directory,
then add --browser chromium. No stealth or challenge-bypass tooling is installed.

## Tests

~~~bash
bun run typecheck
bun test
BOSS_BROWSER_TESTS=1 bun test
~~~

Default tests use synthetic payloads and local files. Opt-in browser tests use
headless Chrome with synthetic pages, including a Node CDP lifecycle test; they never
contact recruitment sites or use personal profiles. They verify login handoff,
full JD persistence, observe-only status, window survival on command success/failure,
and access failures; passing does not prove live access.

Full flags and workflow: [../SKILL.md](../SKILL.md).
