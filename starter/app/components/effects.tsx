"use client"

// Effect events on the order page (ticket 09): the committed changes laid over the
// snapshot, each with the version of the fact it wrote, what it supersedes and who
// committed it; then the order's whole history in sequence (finding, approval, call,
// answer, update approval, effect event).

import type { EffectEvent, EffectType, HistoryEntry } from "@/lib/engine/engine"
import { fmtDateTime } from "@/lib/present/time"
import { recordAnchor } from "./review"
import { More, Pill } from "./ui"

const BY_LABEL: Record<string, string> = { agent: "Agent", policy: "Policy", operator: "Operator" }

// Kept here (not imported from lib/engine/effects.ts, which uses node:crypto) so the client bundle stays small.
const EFFECT_LABEL: Record<EffectType, string> = {
  contact_confirmed: "Contact confirmed", contact_changed: "Contact changed", window_changed: "Window changed",
  call_result_recorded: "Call result recorded", eta_reported: "ETA reported", customer_answer_recorded: "Customer answer recorded",
  operator_answer_recorded: "Operator answer recorded", cost_approved: "Cost approved", record_closed: "Record closed",
}

export function EffectsBlock({ effects, history }: { effects: EffectEvent[]; history: HistoryEntry[] }) {
  if (!effects.length && !history.length) return null
  return <div className="checks-block" id="effects">
    {effects.length > 0 && <>
      <h3>Changes</h3>
      <ul className="effect-list">{effects.map((event) => <li key={event.id} className="effect" id={recordAnchor(event.id)}>
        <div className="effect-head">
          <Pill tone="ok">{EFFECT_LABEL[event.type]}</Pill>
          <span className="effect-at">{fmtDateTime(event.at, null, false)} · {BY_LABEL[event.by] ?? event.by}</span>
        </div>
        <p className="effect-text">{event.text}</p>
      </li>)}</ul>
    </>}
    {history.length > 0 && <More label="History" open={effects.length > 0}>
      <ol className="proposal-history">{history.map((entry, i) => <li key={i} className={entry.kind === "effect" ? "is-effect" : undefined}>
        <span className="proposal-history-at">{fmtDateTime(entry.at, null, false)}</span>
        <span className="proposal-history-by">{BY_LABEL[entry.by] ?? entry.by} · {entry.kind === "effect" ? "change" : entry.kind}</span>
        <span className="proposal-history-text">{entry.text}</span>
      </li>)}</ol>
    </More>}
  </div>
}
