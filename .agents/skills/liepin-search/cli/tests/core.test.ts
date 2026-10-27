import { registerPortalTests } from "../../../../../tools/china_portals/tests.js"
import { chromium } from "playwright"
registerPortalTests("liepin", import.meta.dir, chromium)
