import type { Metadata } from "next"
import { OperatorStart } from "../components/operator-start"

export const metadata: Metadata = { title: "Start · Control Room" }

/** The Operator's start page, between choosing the persona and the work. */
export default function StartPage() {
  return <OperatorStart />
}
