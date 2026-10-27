import type { Job } from "../../../../../../tools/china_portals/model.js"

// Portal metadata stays discoverable by the framework's host classifier.
export const portalMetadata = {
  label: "前程无忧",
  home: "https://we.51job.com/pc/search",
  postingOrigin: "https://jobs.51job.com",
  hosts: ["we.51job.com", "jobs.51job.com", "login.51job.com"],
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
