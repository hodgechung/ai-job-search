import { registerPortalTests } from "../../../../../tools/china_portals/tests.js"
import { chromium } from "playwright"
registerPortalTests("51job", import.meta.dir, chromium)
