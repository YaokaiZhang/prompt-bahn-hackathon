"use client"

import { useEffect, useState } from "react"
import { NAV_LINKS } from "./shell"
import { Windscreen } from "./windscreen"

/** The Operator's destinations around the wheel, with the Briefing's unread count. */
export function OperatorStart() {
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    // Only the count: the Shell's briefing feed would mark the new items as toasted without showing them.
    fetch("/api/briefing", { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ unread: number }> : null)
      .then((view) => { if (view) setUnread(view.unread) })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return <Windscreen
    eyebrow="Operator"
    title={<>Hi, <em>Bahner</em>, where do you want to start today?</>}
    label="Start here"
    choices={NAV_LINKS.map((link) => ({
      key: link.section, label: link.label, href: link.href,
      badge: link.section === "briefing" && unread > 0 ? unread : undefined,
    }))}
    angles={[-72, -48, -24, 0, 24, 48, 72]}
    goingTo="Driving to"
  />
}
