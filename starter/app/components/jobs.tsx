"use client"

// The driver market on the Driver's phone (spec .scratch/publishing): every job live for
// drivers, soonest pickup first. A demanding job carries the travel planner's suggestion,
// folded away and marked as a suggestion only.

import { useEffect, useState } from "react"
import type { DriverJob, DriverJobs } from "@/lib/present/types"
import { fmtDateTime } from "@/lib/present/time"
import { useClockVersion } from "./demo-clock"
import { Icon } from "./icons"
import { TravelPlanView } from "./travel-plan"
import { More, Pill } from "./ui"

/** How often the job list re-reads the market (ms). */
const POLL_MS = 5000

function useJobs(): { jobs: DriverJob[] | null; error: string } {
  const [jobs, setJobs] = useState<DriverJob[] | null>(null)
  const [error, setError] = useState("")
  const clockVersion = useClockVersion()
  useEffect(() => {
    let stopped = false
    const read = () => fetch("/api/phone/jobs")
      .then((response) => { if (!response.ok) throw new Error("Could not load the jobs"); return response.json() as Promise<DriverJobs> })
      .then((data) => { if (!stopped) { setJobs(data.jobs); setError("") } })
      .catch((cause: unknown) => { if (!stopped) setError(cause instanceof Error ? cause.message : "Could not load the jobs") })
    read()
    const timer = setInterval(read, POLL_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [clockVersion])
  return { jobs, error }
}

const slotText = (slot: DriverJob["pickupWindow"]) => slot ? `${fmtDateTime(slot.start, slot.zone, false)}–${fmtDateTime(slot.end, slot.zone).split(" ").slice(2).join(" ")}` : "time to agree"

function JobCard({ job }: { job: DriverJob }) {
  return <li className="job">
    <div className="job-head">
      <b>{job.from.city} → {job.to.city}</b>
      {job.fee && <span className="job-fee">{job.fee}</span>}
    </div>
    <div className="job-meta">{job.reference}{job.car ? ` · ${job.car}` : ""}{job.check.km ? ` · ${job.check.km} km` : ""}</div>
    <div className="job-meta">Pickup {slotText(job.pickupWindow)} · Deliver by {job.deliveryWindow ? fmtDateTime(job.deliveryWindow.end, job.deliveryWindow.zone) : "time to agree"}</div>
    {job.check.demanding && <div className="job-tags"><Pill tone="warn">Demanding</Pill>{job.check.crossBorder && <Pill tone="neutral">{job.from.country} → {job.to.country}</Pill>}{job.check.crossings.length > 0 && <Pill tone="neutral">Ferry or train</Pill>}{job.check.driveHours !== null && job.check.driveHours > 12 && <Pill tone="neutral">~{job.check.driveHours} h driving</Pill>}</div>}
    {job.plan && <More label="Suggested travel plan"><TravelPlanView plan={job.plan} /></More>}
  </li>
}

export function DriverJobsList() {
  const { jobs, error } = useJobs()
  return <section className="phone-jobs" aria-label="Open jobs">
    <h2><Icon name="offer" />Open jobs{jobs ? ` (${jobs.length})` : ""}</h2>
    {error && <p className="phone-error" role="alert">{error}</p>}
    {!jobs && !error && <p className="phone-queue-why">Loading jobs…</p>}
    {jobs && jobs.length === 0 && <p className="phone-queue-why">No open jobs right now.</p>}
    {jobs && jobs.length > 0 && <ul>{jobs.map((job) => <JobCard key={job.orderId} job={job} />)}</ul>}
    <p className="phone-queue-why">Travel plans are suggestions with rough prices. Nothing is booked.</p>
  </section>
}
