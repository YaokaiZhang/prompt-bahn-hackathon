"use client"

import Image from "next/image"
import Link from "next/link"
import type { RecordView, Tile } from "@/lib/present/types"
import { Pill, StagePill } from "../ui"

/** Bahn's image band with an asphalt panel over its foot: the car, its stage and who it is for. */
export function RecordHero({ view }: { view: RecordView }) {
  const { header, story, journey } = view
  const vehicle = header.vehicle
  const photo = vehicle?.illustrationSlug
  return <>
    <section className={`hero${photo ? "" : " no-photo"}`}>
      {photo && <figure className="hero-photo">
        <Image src={`/car-images/${photo}.webp`} alt={`Illustration of a ${vehicle?.title}`} fill sizes="(max-width: 1180px) 100vw, 1120px" priority />
      </figure>}
      <div className="hero-card">
        <div className="hero-pills">
          <StagePill lane={header.lane} label={header.laneLabel} />
          <Pill>{header.reference}</Pill>
          {header.customerReference && <Pill>Customer ref {header.customerReference}</Pill>}
          {photo && <Pill>Model illustration, not this car</Pill>}
        </div>
        <h1 className="display hero-title">{vehicle ? vehicle.title : "Vehicle not linked"}</h1>
        <p className="hero-facts">
          <span>For <Link href={`/customers/${header.customer.id}`}>{header.customer.name}</Link></span>
          <span>Plate <b>{vehicle?.plate ?? "none"}</b></span>
          <span>VIN <b>{vehicle?.vin ?? "none"}</b></span>
          <span>{header.routeKindLabel}{journey.distanceKm ? ` · ${journey.distanceKm} km` : ""}</span>
          {header.tradeIn && <span>Trade-in <b>{header.tradeIn.title}</b></span>}
        </p>
        <p className="hero-intro">{story.intro}</p>
      </div>
    </section>
    <div className="story">
      <p className={`story-headline tone-${story.tone}`}>{story.headline}</p>
      {story.detail && <p className="story-detail">{story.detail}</p>}
    </div>
  </>
}

export function KeyDates({ tiles }: { tiles: Tile[] }) {
  return <div className="dates">{tiles.map((tile) => {
    const body = <>
      <div className="date-label">{tile.label}</div>
      <div className="date-value">{tile.value}</div>
      {tile.hint && <div className="date-hint">{tile.hint}</div>}
    </>
    return tile.href
      ? <Link className={`date tone-${tile.tone}`} href={tile.href} key={tile.label}>{body}</Link>
      : <div className={`date tone-${tile.tone}`} key={tile.label}>{body}</div>
  })}</div>
}
