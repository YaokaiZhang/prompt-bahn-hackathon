# Car Delivery Control Room

A control room where people and agents work together to get cars delivered, built for Bahn's challenge at the Prompt Operations Hackathon (24–25 Oct 2026). The product plan is in [`docs/PRD.md`](docs/PRD.md).

All data is fictional. Nothing real is connected.

## Layout

- `dataset/data/`: the fictional snapshot (100 orders), as JSONL. `dataset/SCHEMA.md` explains every field.
- `attachments/`: fictional documents, receipts and photos, with `manifest.json`.
- `starter/`: the Next.js, TypeScript and Postgres app.

## Run

You need Node.js 24+ and Docker.

```sh
cd starter
cp .env.example .env
npm ci
docker compose up -d --wait
npm run db:push
npm run db:seed
npm run attachments:seed
npm run dev
```

Open http://localhost:3000.
