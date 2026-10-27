import type { Job } from "../../../../../../tools/china_portals/model.js"

// Portal metadata stays discoverable by the framework's host classifier.
export const portalMetadata = {
  label: "猎聘",
  home: "https://www.liepin.com/",
  postingOrigin: "https://www.liepin.com",
  hosts: ["www.liepin.com", "safe.liepin.com"],
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
