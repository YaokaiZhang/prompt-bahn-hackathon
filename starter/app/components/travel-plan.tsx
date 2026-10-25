"use client"

// The travel planner's suggestion for a demanding job (spec .scratch/publishing): legs
// with rough prices against the budget. A recommendation only: nothing is booked. The
// Driver's phone shows it with the job; the order page keeps it folded at the bottom.

import type { DemandCheck, Publication } from "@/lib/engine/publishing"
import type { LegKind, TravelPlan } from "@/lib/engine/travel-planner"
import { Icon } from "./icons"
import { Pill } from "./ui"

const LEG_ICON: Record<LegKind, string> = { train: "train", ferry: "ferry", hotel: "hotel", drive: "car", flight: "plane", local: "pin" }
const eur = (value: number) => `EUR ${value.toLocaleString("en-GB")}`

export function TravelPlanView({ plan }: { plan: TravelPlan }) {
  return <div className="travel-plan">
    <p className="travel-plan-summary">{plan.summary}</p>
    <ol className="travel-legs">{plan.legs.map((leg, i) => <li key={i} className={`travel-leg travel-leg-${leg.kind}`}>
      <Icon name={LEG_ICON[leg.kind]} />
      <div>
        <div className="travel-leg-route">{leg.kind === "hotel" ? `Hotel · ${leg.to}` : `${leg.from} → ${leg.to}`}</div>
        <div className="travel-leg-when">{leg.when}</div>
        {leg.note && <div className="travel-leg-note">{leg.note}</div>}
      </div>
      <span className="travel-leg-cost">{leg.costEur ? `~${eur(leg.costEur)}` : "–"}</span>
    </li>)}</ol>
    <p className="travel-plan-total">
      Rough total <b>{eur(plan.totalEur)}</b> against a budget of {eur(plan.budgetEur)}{" "}
      <Pill tone={plan.withinBudget ? "ok" : "warn"}>{plan.withinBudget ? "within budget" : "over budget"}</Pill>
    </p>
    <p className="travel-plan-hotel">{plan.hotel.needed ? "Hotel needed" : "No hotel needed"}{plan.hotel.why ? `: ${plan.hotel.why}` : ""}</p>
    {plan.caveats.length > 0 && <ul className="travel-plan-caveats">{plan.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>}
    <p className="travel-plan-source">Suggestion only, nothing is booked · {plan.source === "model" ? `drafted by the travel planner${plan.cached ? " (cached)" : ""}` : plan.note ?? "template plan"}</p>
  </div>
}

function why(check: DemandCheck): string {
  return check.demanding ? check.reasons.join(" ") : "Not demanding: a domestic drive under 12 hours with no ferry or train."
}

/** The order page's folded "Travel plan" section: last on the page, closed by default. */
export function TravelPlanSection({ publication }: { publication: Publication }) {
  const { check, plan } = publication
  if (!check) return null
  const sub = !check.demanding ? "not a demanding job" : plan ? `suggestion · rough ${eur(plan.totalEur)} of ${eur(plan.budgetEur)} budget` : publication.planError ? "the planner failed" : "being drafted"
  return <section className="records travel-plan-section">
    <details className="rec" id="travel-plan">
      <summary>
        <Icon name="train" size={15} />
        <span><span className="rec-title">Travel plan</span><span className="rec-sub">{sub}</span></span>
        <span className="rec-count" />
        <Icon name="chevron" size={13} className="chev" />
      </summary>
      <div className="rec-body">
        <p className="travel-plan-why">Demand filter: {why(check)}</p>
        {plan ? <TravelPlanView plan={plan} />
          : check.demanding ? <p className="travel-plan-why">{publication.planError ?? "The travel planner drafts it shortly; drivers see the job once it is there."}</p>
          : <p className="travel-plan-why">No travel plan for this job. Travel budget {eur(publication.budgetEur)}.</p>}
      </div>
    </details>
  </section>
}
