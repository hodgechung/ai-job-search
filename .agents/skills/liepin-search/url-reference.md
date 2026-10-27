# 猎聘 integration reference

Observed 2026-10-26. Live search/full-JD/cache verification passed.

Origin https://www.liepin.com. The normal search UI generates /zhaopin/ with
key, city, dq, currentPage (zero-based), and pageSize=40. 杭州 is 070020;
other city codes are read from [data-key=dq][data-code] in the visible filter.
Cards: .jobDetailBox, a[data-nick=job-detail-job-info], .jobTitleBox [title],
.jobTitleBox span.ellipsis-1, .companyName. Normal detail links are
/job/<digits>.shtml or /a/<digits>.shtml. Tracking query parameters are discarded;
job_ and a_ ID prefixes prevent namespace collisions. Public detail HTML: dd[data-selector=job-intro-content]; primary title/salary
inside .job-apply-content; primary employer inside .company-card .name. Ignore
recommended-company blocks. Details use public HTML with an honest tool UA, no
cookies or signed API replay. safe.liepin.com is a manual verification gate.
robots.txt disallows query URLs. This is an explicitly authorized, low-volume
personal browser workflow; it is not a public API or permission to republish.

Sources: [猎聘](https://www.liepin.com/).

No signed API requests, credential extraction, fingerprint changes, stealth
drivers or challenge solving are implemented. Only normal browser navigation
and rendered posting data are used. Never commit captured live responses.
