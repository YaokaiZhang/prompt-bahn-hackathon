// What a tier-1 call says (ticket 10): fixed keypad questions, no model involved.
// Each question has fixed wording (so its speech is generated once and cached) and
// keypad options. An option either records what the person said (a claim, "call
// result recorded"), asks for a change to the order (a change proposal: needs a
// yes), or escalates to tier 2 ("it's complicated", a reported problem).
//
// Which questions a call asks follows its topics: the rules that planned it
// (R1 release, R4/R5 contact, R6/NEXT readiness, R10 on track, R12 on time) and
// the reviewer's call proposals (keys, or the proposal's own question).

export type QuestionId =
  | "available" | "callback_time"
  | "contact" | "ready" | "release" | "keys" | "on_track" | "on_time" | "question"

export type OptionEffect =
  /** What the person said, recorded on the order as a call result. */
  | { type: "claim"; text: string }
  /** A change the person asked for or confirmed: becomes a change proposal (needs a yes). */
  | { type: "change"; title: string; change: string; claim: string }
  /** Needs a conversation: the call moves to tier 2. */
  | { type: "escalate"; text: string }

export type KeyOption = { digit: string; label: string; effect: OptionEffect }

export type Question = {
  id: QuestionId
  /** What the agent says (spoken by TTS). */
  text: string
  options: KeyOption[]
  /** The topics this question answers. */
  topics: string[]
}

/** A topic is one reason to call: `rule:R10`, `proposal:<id>`, or `check:on_time` (asked only when the operator rings live). */
export type Topic = {
  id: string
  kind: "rule" | "proposal" | "check"
  title: string
  script?: string
  /**
   * The records the topic asks about: a rule's restatable sources, the tracking
   * observation (or reported ETA) the tight-ETA check read, a proposal's conflict
   * evidence. A call result that answers the topic supersedes them. Absent on calls
   * stored before topics named their records.
   */
  records?: string[]
}

export const CALLBACK_MINUTES: Record<string, number> = { "1": 15, "2": 60, "3": 120 }

export function greeting(input: { name: string | null; reference: string; car: string | null; line: "site" | "driver" }): string {
  const hello = input.name ? `Hello ${input.name.split(",")[0]}` : "Hello"
  const about = input.line === "driver" ? `your delivery of order ${input.reference}` : `the pickup for order ${input.reference}`
  return `${hello}, this is the delivery assistant from the car delivery control room, calling about ${about}${input.car ? `, the ${input.car}` : ""}.`
    + " Is now a good time for a few quick questions? Press 1 for yes, or 2 and I'll call back later."
}

export const AVAILABLE_OPTIONS: KeyOption[] = [
  { digit: "1", label: "Yes, now is fine", effect: { type: "claim", text: "Available" } },
  { digit: "2", label: "Call back later", effect: { type: "claim", text: "Busy" } },
]

export const CALLBACK_QUESTION = "When should I call back? Press 1 for in 15 minutes, 2 for in an hour, or 3 for in two hours."
export const CALLBACK_OPTIONS: KeyOption[] = Object.entries(CALLBACK_MINUTES).map(([digit, minutes]) => ({
  digit, label: minutes < 60 ? `In ${minutes} minutes` : minutes === 60 ? "In an hour" : `In ${minutes / 60} hours`, effect: { type: "claim", text: `Call back in ${minutes} minutes` },
}))

export const RETRY_PREFIX = "Sorry, I didn't catch that. "
export const CLOSING = "Thank you, that's all I needed. Goodbye."
export const HANDOVER_LINE = "Thank you. This needs a proper conversation, so a colleague from the control room will follow up with you. Goodbye."
export const callbackLine = (local: string) => `No problem. I'll call you back at ${local}. Goodbye.`

const yesNo = (yes: OptionEffect, no: OptionEffect): KeyOption[] => [
  { digit: "1", label: "Yes", effect: yes },
  { digit: "2", label: "No", effect: no },
]

/** The fixed questions by id; `question` (a reviewer question read aloud) is built per proposal. */
function fixed(id: Exclude<QuestionId, "available" | "callback_time" | "question">, who: { name: string | null; handle: string }): Omit<Question, "topics"> {
  const named = who.name ? `${who.name.split(",")[0]} (${who.handle})` : who.handle
  switch (id) {
    case "contact":
      return {
        id, text: "Are you the right person to hand over this car at pickup? Press 1 for yes, or 2 for no.",
        options: yesNo(
          { type: "change", title: "Confirm the pickup contact", change: `Pickup contact confirmed for this order by phone: ${named}.`, claim: "Confirmed they are the pickup contact" },
          { type: "escalate", text: "Says they are not the pickup contact" },
        ),
      }
    case "ready":
      return {
        id, text: "Will the car be ready for collection in the booked pickup slot? Press 1 for yes, or 2 for no.",
        options: yesNo({ type: "claim", text: "The car will be ready in the booked pickup slot" }, { type: "escalate", text: "The car will not be ready in the booked slot" }),
      }
    case "release":
      return {
        id, text: "Do you have the signed release for this car, ready to hand to our driver? Press 1 for yes, or 2 for no.",
        options: yesNo({ type: "claim", text: "The signed release is at the site, ready for the driver" }, { type: "escalate", text: "No signed release at the site yet" }),
      }
    case "keys":
      return {
        id, text: "Where should our driver collect the keys? Press 1 for the booked collection bay, 2 for reception, 3 for stock control, or 0 if it's more complicated.",
        options: [
          ...[["1", "the booked collection bay"], ["2", "reception"], ["3", "stock control"]].map(([digit, desk]) => ({
            digit, label: desk[0].toUpperCase() + desk.slice(1),
            effect: { type: "change" as const, title: "Record where the keys are collected", change: `Keys for this pickup are collected at ${desk} (said by ${named} on the phone).`, claim: `Keys are collected at ${desk}` },
          })),
          { digit: "0", label: "It's more complicated", effect: { type: "escalate", text: "Key collection is more complicated" } },
        ],
      }
    case "on_track":
      return {
        id, text: "Are you still on track with this delivery? Press 1 for yes, or 2 if there is a problem.",
        options: yesNo({ type: "claim", text: "Driver is still on track" }, { type: "escalate", text: "Driver reports a problem" }),
      }
    case "on_time":
      return {
        id, text: "Can you still deliver within the promised window? Press 1 for yes, or 2 for no.",
        options: yesNo({ type: "claim", text: "Driver can still deliver within the promised window" }, { type: "escalate", text: "Driver cannot deliver within the promised window" }),
      }
  }
}

const RULE_QUESTION: Record<string, Exclude<QuestionId, "available" | "callback_time" | "question">> = {
  R1: "release", R4: "contact", R5: "contact", R6: "ready", NEXT: "ready", R10: "on_track", R12: "on_time",
}

/** The tier-1 questions for a call's topics, in a stable order, one per question id. */
export function questionsFor(topics: Topic[], who: { name: string | null; handle: string }): Question[] {
  const out: Question[] = []
  const add = (question: Omit<Question, "topics">, topic: string) => {
    const same = out.find((row) => row.id === question.id && row.text === question.text)
    if (same) { if (!same.topics.includes(topic)) same.topics.push(topic); return }
    out.push({ ...question, topics: [topic] })
  }
  for (const topic of topics) {
    if (topic.kind === "check") {
      if (topic.id === "check:on_time") add(fixed("on_time", who), topic.id)
      continue
    }
    if (topic.kind === "rule") {
      const id = RULE_QUESTION[topic.id.replace(/^rule:/, "")]
      if (id) add(fixed(id, who), topic.id)
      continue
    }
    const text = `${topic.title} ${topic.script ?? ""}`
    if (/\bkeys?\b/i.test(text)) { add(fixed("keys", who), topic.id); continue }
    add({
      id: "question",
      text: `${topic.script ?? topic.title} Press 1 if you can answer this now, or 2 if you can't.`,
      options: yesNo({ type: "escalate", text: "Can answer, needs a conversation" }, { type: "claim", text: `Could not answer: ${topic.title}` }),
    }, topic.id)
  }
  const ORDER: QuestionId[] = ["contact", "ready", "release", "keys", "on_track", "on_time", "question"]
  return out.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id))
}
