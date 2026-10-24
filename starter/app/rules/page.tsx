// The Rules page (ticket 07): read-only. The approval policy (who is contacted, the
// kind of action, and whether the agent acts alone, needs a yes or may only propose)
// and every rule check with its first action. Both are read from their one source:
// POLICY in lib/reviewer/policy.ts and RULE_CATALOGUE in lib/engine/rules.ts.
// Proposals link here as /rules#<policy row id>.

import type { Metadata } from "next"
import Link from "next/link"
import { RULE_CATALOGUE, type RuleInfo } from "@/lib/engine/rules"
import { CONTACT_TYPE_LABEL, CONTACT_TYPES, POLICY, policyFor, type ActionType, type Decision } from "@/lib/reviewer/policy"
import type { Tone } from "@/lib/present/types"
import { Shell } from "../components/shell"
import { Pill } from "../components/ui"

export const metadata: Metadata = { title: "Rules · Control Room" }

const DECISION_TONE: Record<Decision, Tone> = { "acts alone": "accent", "needs a yes": "warn", "propose only": "danger" }
const ACTIONS: { type: ActionType; label: string }[] = [{ type: "question", label: "Ask a question or call" }, { type: "change", label: "Change the order" }]

function RuleRow({ rule }: { rule: RuleInfo }) {
  return <li className="rule-row" id={`rule-${rule.id}`}>
    <dl><dt>Rule</dt><dd className="rule-name"><span className="rule-id"><Pill>{rule.id}</Pill></span>{rule.title}</dd></dl>
    <dl><dt>Kind</dt><dd>{rule.strength === "strong" ? "Strong rule" : "Weak signal: never fails, feeds couldn't check"}</dd></dl>
    <dl><dt>First action</dt><dd>{rule.firstAction}</dd></dl>
  </li>
}

export default function RulesPage() {
  const rules = Object.values(RULE_CATALOGUE)
  const strong = rules.filter((rule) => rule.strength === "strong")
  const weak = rules.filter((rule) => rule.strength === "weak")
  return <Shell section="rules"><main className="page rules-page">
    <header className="entity-head">
      <h1 className="display">Rules</h1>
      <p className="rules-intro">What the agent may do on its own, what needs your yes, and what it only proposes. The contact&apos;s type decides, never the person who answers. Every proposal names the policy row it falls under.</p>
    </header>

    <section className="rules-section" aria-labelledby="policy-head">
      <h2 id="policy-head">Approval policy</h2>
      <p>Who is contacted, the kind of action, and whether the agent acts alone or needs a yes. The agent never contacts the customer side itself, with one exception: a pickup-readiness call to the order&apos;s pickup place or pickup contact. It never calls the paying customer.</p>
      <ol className="rules-list">{POLICY.map((row) => <li className="rule-row" id={row.id} key={row.id}>
        <dl>
          <dt>Who is contacted</dt>
          <dd className="rule-name">{row.contact}</dd>
          <dd className="rule-types">{row.contactTypes.length === CONTACT_TYPES.length
            ? <Pill>Any contact type</Pill>
            : row.contactTypes.map((type) => <Pill key={type}>{CONTACT_TYPE_LABEL[type]}</Pill>)}</dd>
        </dl>
        <dl><dt>Kind of action</dt><dd>{row.action}</dd><dd><Pill>{row.id}</Pill></dd></dl>
        <dl><dt>The agent</dt><dd><Pill tone={DECISION_TONE[row.decision]}>{row.decision}</Pill></dd><dd>{row.agentDoes}</dd></dl>
      </li>)}</ol>
    </section>

    <section className="rules-section" aria-labelledby="matrix-head">
      <h2 id="matrix-head">By contact type</h2>
      <p>The same table read the other way: each contact type and action, and the row that decides it.</p>
      <ol className="rules-list">{CONTACT_TYPES.map((type) => <li className="rule-row" key={type}>
        <dl><dt>Contact type</dt><dd className="rule-name">{CONTACT_TYPE_LABEL[type]}</dd></dl>
        {ACTIONS.map((action) => {
          const row = policyFor(type, action.type)
          return <dl key={action.type}><dt>{action.label}</dt><dd>
            <Link className="policy-link" href={`#${row.id}`}><Pill tone={DECISION_TONE[row.decision]}>{row.decision}</Pill><span>{row.id}</span></Link>
          </dd></dl>
        })}
      </li>)}</ol>
    </section>

    <section className="rules-section" aria-labelledby="checks-head">
      <h2 id="checks-head">Rule checks</h2>
      <p>Deterministic checks run on every order at the demo clock. A strong rule that fails takes its first action; weak signals list what couldn&apos;t be checked.</p>
      <ol className="rules-list">{strong.map((rule) => <RuleRow key={rule.id} rule={rule} />)}</ol>
      <ol className="rules-list">{weak.map((rule) => <RuleRow key={rule.id} rule={rule} />)}</ol>
    </section>
  </main></Shell>
}
