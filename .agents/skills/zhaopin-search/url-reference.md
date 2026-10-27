# 智联招聘 integration reference

Observed 2026-10-26; anonymous search/full-JD/cache verified 2026-10-27.

Origin https://www.zhaopin.com. Public search /sou/jl<CITY>/kw<KEYWORD>/p1;
杭州 is 653. KEYWORD is base32hex of UTF-16BE bytes, observed from the site's
own search box ("Java 后端" -> 01500O80EO062010AG77LRO). This URL encoding is
not authentication/signature generation. Cards: .joblist-box__item,
a.jobinfo__name, .companyinfo__name, .jobinfo__salary, .jobinfo__other-info-item.
Detail /jobdetail/CC...htm on www.zhaopin.com; legacy jobs.zhaopin.com/CC...htm
is also recognized. The site's HTTP posting links are upgraded to HTTPS before
strict host/path validation. Body: .describtion-card__detail-content. Anonymous HTTP 200 responses supply the
full body, including the CSS-folded --guest-clamp section. Parse supplied HTML;
CSS folding alone is not authentication. Primary title: h1.summary-planes__title;
primary company: a.company-info__name. No cookies or signed API requests are used.
The browser may redirect the public SEO search to a new /jobs/ UI after hydration;
the adapter parses the original public HTML cards instead of depending on that UI.
Salary may be masked for guests; do not invent a numeric value. No observed
posting date is used. passport.zhaopin.com is a login gate. robots.txt forbids
query/API routes; the observed public SEO route has no query string.

Sources: [智联招聘](https://www.zhaopin.com/).

No signed API requests, credential extraction, fingerprint changes, stealth
drivers or challenge solving are implemented. Only anonymous public HTML and optional ordinary browser navigation are used. Never commit captured live responses.
