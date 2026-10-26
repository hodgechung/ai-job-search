# /boss - BOSS直聘只读搜索

Use `.agents/skills/boss-search/SKILL.md` and its CLI for this request.

- `/boss login`: run the CLI's `login` command. Open one window only, tell the user
  to complete login/verification, and leave it undisturbed while they scan. The
  command returns manual_login immediately, which is NOT proof of authentication.
  Run status only after the user confirms completion. Never refresh or reopen the
  page during handoff; commands disconnect without closing the external window.
- `/boss status`: run `status`, report the actual authentication state.
- `/boss <keywords> <city>`: use the explicitly supplied keywords and city with
  `search -q ... -l ... --limit 10 --format json`. If either is missing, ask for it.
- `/boss <BOSS job URL>`: use `detail <url> --format plain`, retaining snapshot time.

Read the skill before choosing flags. This portal is experimental and enabled for
general `/scrape` discovery after a successful live smoke test on 2026-10-22:
authenticated session, one search result with full JD, and cached-only detail.
Future access still depends on the session and site. Never claim synthetic fixtures
are real jobs. Do not send messages, upload files or apply through this CLI.

For successful searches, pass real results to the existing job-scraper workflow
from Step 2 onward: tag `portal: boss-search`, `source: cli`, use the state helper
for deduplication, and preserve complete cached JDs for `/rank` and `/apply`.
Do not invent a posting date or label a snapshot as a live availability check.
