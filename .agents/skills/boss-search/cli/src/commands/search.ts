import { formatDetail, type Job } from "../helpers.js"

/** The existing /scrape envelope, with complete locally captured descriptions. */
export function renderSearch(jobs: Job[], format: string, page: number, query: string, city: string): void {
  if (format === "json") {
    process.stdout.write(JSON.stringify({ meta: { count: jobs.length, page, query, city,
      source: "browser", snapshot: true, dateFilterSupported: false }, results: jobs }, null, 2) + "\n")
  } else if (format === "plain") {
    process.stdout.write(jobs.length ? jobs.map(formatDetail).join("\n\n") + "\n" : "No results.\n")
  } else {
    process.stdout.write(["ID\tTITLE\tCOMPANY\tLOCATION\tSALARY", ...jobs.map(job =>
      [job.id, job.title, job.company, job.location, job.salary]
        .map(v => String(v ?? "—").replace(/[\r\n\t]/g, " ")).join("\t"))].join("\n") + "\n")
  }
}
