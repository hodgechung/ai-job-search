import { registerPortalTests } from "../../../../../tools/china_portals/tests.js"
import { chromium } from "playwright"
registerPortalTests("zhaopin", import.meta.dir, chromium)
