import Link from "next/link"
import type { ReactNode } from "react"
import { fmtDateTime } from "@/lib/present/time"
import { BahnLogo } from "./logo"

export type Section = "orders" | "inbox" | "customers" | "drivers" | "sites"

const LINKS: { section: Section; href: string; label: string }[] = [
  { section: "orders", href: "/", label: "Orders" },
  { section: "inbox", href: "/inbox", label: "Inbox" },
  { section: "customers", href: "/customers", label: "Customers" },
  { section: "drivers", href: "/drivers", label: "Drivers" },
  { section: "sites", href: "/sites", label: "Places" },
]

/** Bahn's page header: wordmark, pill navigation in a sand track, and the snapshot clock. */
export function Shell({ children, section, snapshotAt, fixed = false }: { children: ReactNode; section: Section; snapshotAt?: string | null; fixed?: boolean }) {
  return <div className={`shell${fixed ? " shell-fixed" : ""}`}>
    <header className="bar">
      <Link href="/" className="brand" aria-label="Control Room home">
        <BahnLogo />
        <span className="brand-room">Control Room</span>
      </Link>
      <nav className="nav" aria-label="Main navigation">
        {LINKS.map((link) => <Link key={link.section} href={link.href} aria-current={section === link.section ? "page" : undefined}>{link.label}</Link>)}
      </nav>
      <div className="clock">{snapshotAt
        ? <><b>{fmtDateTime(snapshotAt, null, false)} UTC</b><span>Snapshot · fictional data</span></>
        : <span>Fictional snapshot</span>}</div>
      <span className="bar-fiction">Fictional data</span>
    </header>
    <div className="shell-main">{children}</div>
  </div>
}
