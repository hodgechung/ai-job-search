# 前程无忧 integration reference

Observed 2026-10-26; search/full-JD/cache verified 2026-10-27 without prior login.

Search origin https://we.51job.com/pc/search. Verified on 2026-10-27:
/pc/search?keyword=Java%20后端&jobArea=080200 initializes the requested keyword
and single Hangzhou city before the first normal browser search response.
Normal UI input/filter changes can be overwritten during asynchronous initial
hydration, so the adapter uses this verified public URL instead of city clicks.

The site's actual loaded city dictionary is
https://fecdn.51jobcdn.com/fe/static/51job/2026/01/21/942631f516198b042/seo_dd_areas.js
It confirms 北京010000、上海020000、广州030200、深圳040000、武汉180200、西安200200、
杭州080200、南京070200、成都090200、重庆060000、东莞030800.

Observe the resulting /api/job/search-pc response in the browser; require the
same keyword/jobArea and a resultbody.job object. Never replay the API or its
headers/signatures. Cards .joblist-item-job contain .jname, .cname, .sal, .area;
rendered sensorsdata contains jobId, keyword, jobArea, jobYear and jobDegree.
Read only posting fields. Wait for matching city cards before accepting data.

Normal title clicks open jobs.51job.com/<city>/<numeric-id>.html. The numeric-ID
/all/<id>.html route was verified with Hangzhou posting 173729797: Java后端开发工程师,
杭州稳当科技有限公司. h1 supplies the title, .bmsg.job_msg the full JD and .com_name
the primary company. Search and cached-only reads also passed, including requested
city, salary, experience and education. No prior account login was required.
A WAF challenge can still appear on individual navigations; preserve it and stop.
An already loaded detail is captured without reloading; --refresh is explicit.

robots.txt on www/we returns HTML rather than robots rules;
that is unknown, not permission or a parsed allow-all response.

Sources: [前程无忧](https://www.51job.com/).

No signed API requests, credential extraction, fingerprint changes, stealth
drivers or challenge solving are implemented. Only normal browser navigation
and rendered posting data are used. Never commit captured live responses.
