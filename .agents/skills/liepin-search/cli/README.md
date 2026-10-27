# 猎聘 CLI

Run `bun install`, `bun run typecheck`, and `bun test` here. Browser fixtures
are opt-in: `BROWSER_PORTAL_TESTS=1 bun test --timeout 30000`; they use isolated
headless Chrome and synthetic pages, never recruitment sites or personal profiles.

Live use and flags: [../SKILL.md](../SKILL.md). Implementation and browser/session
handling are shared in tools/china_portals/ to keep the three adapters consistent.
Live search/full-JD/cached-only verification passed on 2026-10-26 and the portal
is enabled. Search uses the browser; details read public posting HTML without
cookies or signed API calls. Browser commands use a Node worker because this
project's Bun CDP transport stalled against Chrome; Bun remains the entry point.
