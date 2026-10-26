# BOSS response reference

Status: live smoke test passed on 2026-10-22 (authenticated session, one Shanghai
Python result with full browser-captured JD, and cached-only detail retrieval).
This is bounded evidence; it does not guarantee future access.
Source review: 2026-10-21. Native login revision: 2026-10-22.

## Browser and response paths

Origin: https://www.zhipin.com

- QR login UI: /web/user/?ka=header-login; open once for manual sign-in.
- Search UI: /web/geek/job?query=KEYWORD&city=CITY_CODE&page=1.
- Detail UI: /job_detail/ENCRYPTED_ID.html.
- Search response: /wapi/zpgeek/search/joblist.json; zpData.jobList.
- Detail response: /wapi/zpgeek/job/detail.json; zpData.jobInfo and brandComInfo.

These are internal site endpoints, not a public developer API. The adapter observes
responses triggered by browser navigation. It does not replay signed requests,
extract credentials for direct HTTP calls, change fingerprints or solve challenges.

## Field mapping

Search: encryptJobId (fallback encryptId), jobName, brandName, cityName, salaryDesc,
jobExperience, jobDegree.

Detail jobInfo: encryptId, jobName, postDescription, locationName, salaryDesc,
experienceName, degreeName, jobStatusDesc. Company: brandComInfo.brandName.

A saved JD requires ID, title, company and complete description. Another ID's detail
is discarded. Publication dates remain null when unknown. Refresh/activity times
are not publication dates. Unknown recruitment state is null; closed text produces
isActive false.

Fallback list anchors: li.job-card-box, a.job-name / a[href*='/job_detail/'],
.company-name / .boss-name, .job-area / .company-location, .salary.
Only complete detail JSON is accepted for a saved JD, never a title/snippet.

## Sessions

Ordinary Chrome is launched separately with a dedicated native-profile directory,
an explicit loopback-only debugging port and no Playwright launch flags. No browser
connection is made during manual sign-in. The CLI returns manual_login immediately.
Node.js connects only for status/search/detail. It disconnects on completion and
never closes the user's external window/context. Repeated login reuses the open
window; status never navigates. A process lock serializes browser operations.
The default personal Chrome profile is never debugged or copied.

Bun 1.3.10 stalled while connecting Playwright 1.64.1 CDP to an isolated Chrome;
Node 23.5.0 connected to the same endpoint. The Bun entry point therefore builds an
ignored Node worker. No stealth drivers or fingerprint overrides are installed.

Authentication signals: visible li.nav-figure, login links/QR prompts, verification
URLs/content. Cookie presence alone is insufficient. 403/429 remain access/rate-limit
errors. Authentication completion does not trigger another navigation automatically.
The first release supports page 1 only, at most 20 results.

## Research sources

- [get_jobs reviewed revision](https://github.com/loks666/get_jobs/tree/a78db87b1da539120eeb843e6ab2fc36998bc2c0):
  reference for response shapes and browser workflow. This is a new TypeScript
  implementation; no Java source is vendored. Consult that repository's license
  before copying its implementation.
- [Playwright persistent contexts](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context)
- [Playwright network events](https://playwright.dev/docs/network)
- [BOSS robots.txt](https://www.zhipin.com/robots.txt): reviewed rules restrict query
  URLs. Browser access does not remove platform terms or confer authorization.

- [Chrome remote debugging isolation](https://developer.chrome.com/blog/remote-debugging-port)
- [Playwright CDP connection](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp)
