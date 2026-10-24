// Reads the dataset's JSONL files. The seed and the engine tests both start here.

import { createReadStream } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { tablesFromSource, type Manifest, type SnapshotTables, type SourceRow } from "./tables"

/** The packet ships its records in ../dataset/data. Set DATASET_DIR to use another folder with the same files. */
export function datasetDir(): string {
  return process.env.DATASET_DIR ?? join(process.cwd(), "..", "dataset", "data")
}

async function readCollection(dir: string, collection: string): Promise<SourceRow[]> {
  const stream = createReadStream(join(dir, `${collection}.jsonl`), "utf8")
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  const rows: SourceRow[] = []
  for await (const line of lines) if (line.trim()) rows.push(JSON.parse(line) as SourceRow)
  return rows
}

/** Every collection named in the manifest, checked against the manifest's row counts. */
export async function readDataset(dir = datasetDir()): Promise<{ manifest: Manifest; source: Map<string, SourceRow[]> }> {
  const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Manifest
  const source = new Map<string, SourceRow[]>()
  for (const collection of Object.keys(manifest.tables).sort()) {
    const collectionRows = await readCollection(dir, collection)
    if (collectionRows.length !== manifest.tables[collection]) {
      throw new Error(`${collection}: manifest expects ${manifest.tables[collection]} rows, found ${collectionRows.length}`)
    }
    source.set(collection, collectionRows)
  }
  return { manifest, source }
}

export async function readSnapshotTables(dir = datasetDir()): Promise<SnapshotTables> {
  const { manifest, source } = await readDataset(dir)
  return tablesFromSource(manifest, source)
}
