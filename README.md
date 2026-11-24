# RoleTry

Personal AI career assistant: try Customer Success and Support Operations on the same payroll incident, get live Sarvam coaching, and save progress on-device.

## Stack

- Next.js App Router + TypeScript + plain CSS
- Sarvam `sarvam-105b` chat + optional speech-to-text
- `localStorage` persistence (no login)

## Setup

```bash
npm install
cp .env.example .env.local   # set SARVAM_API_KEY
npm run dev
```

## Environment

- `SARVAM_API_KEY` — server-only; never exposed to the client

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm start` — serve production build
