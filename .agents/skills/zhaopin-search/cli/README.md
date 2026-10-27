# 智联招聘 CLI

Run `bun install`, `bun run typecheck`, and `bun test` here. Browser fixtures
are opt-in: `BROWSER_PORTAL_TESTS=1 bun test --timeout 30000`; they use isolated
headless Chrome and synthetic pages, never recruitment sites or personal profiles.

Live use and flags: [../SKILL.md](../SKILL.md). Implementation and browser/session
handling are shared in tools/china_portals/ to keep the three adapters consistent.
Live Hangzhou Java search, full JD and cached-only retrieval passed without prior
login on 2026-10-27; the skill is enabled. Browser commands use a Node worker because this
project's Bun CDP transport stalled against Chrome; Bun remains the entry point.
