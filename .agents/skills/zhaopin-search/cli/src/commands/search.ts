import type { Job } from "../../../../../../tools/china_portals/model.js"

// Portal metadata stays discoverable by the framework's host classifier.
export const portalMetadata = {
  label: "智联招聘",
  home: "https://www.zhaopin.com/",
  postingOrigin: "https://www.zhaopin.com",
  hosts: ["www.zhaopin.com", "jobs.zhaopin.com", "passport.zhaopin.com"],
} as const

/** The per-portal output boundary consumed by /scrape and /rank. */
export function searchResult(job: Job): Job {
  return {
    ...job,
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    date: job.date,
    url: job.url,
  }
}
