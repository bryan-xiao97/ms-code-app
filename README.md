# Sell-Side M&A Platform

A deal-management platform for sell-side M&A engagements. It tracks the 5-phase
process (Preparation → Marketing/CIM → Buyer GTM → Detailed Diligence → Close),
deal milestones, and per-deal activity, with strict deal-level isolation enforced
in the database.

**Status:** Phase 1 (Foundation) and Phase 2 (Deal PM shell) are implemented.
Phase 3 (DD Q&A RAG) and Phase 4 (Buyers + IMAP) are scaffolded as stubs.

## Tech stack

| Layer | Choice |
|------|--------|
| Framework | Next.js 16 (App Router, React Server Components, Turbopack) |
| UI | React 19, Tailwind CSS 4 |
| Language | TypeScript (strict — `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| Backend | Supabase — Postgres + Auth + Storage + pgvector |
| DB clients | `@supabase/ssr`, `@supabase/supabase-js` |
| Validation | Zod |
| Tests | Vitest + Testing Library (jsdom), Playwright (chromium) |
| Local mail | Mailpit (Supabase CLI) |
| CI | GitHub Actions |
| Package manager | pnpm |

There is **no separate API server**. The backend is Next.js Server Actions and
Route Handlers talking to Supabase, with Postgres **Row-Level Security (RLS)** as
the authorization boundary.

## Architecture

```
Browser ──┬─ simple reads/writes ───────────────► Supabase (anon key, RLS-gated)
          │     lib/supabase/client.ts
          │
          └─ form submit ─► Server Action ─┬─ user client (RLS)  → lib/supabase/server.ts
                                            └─ service client     → lib/supabase/service.ts
                                               (bypasses RLS; createDeal only)

middleware.ts — refreshes the Supabase session and redirects
                unauthenticated users to /sign-in
```

Two data channels:

- **Direct supabase-js from the browser** for simple CRUD (e.g. milestones). RLS
  gates every row, so the client can only touch deals the user belongs to.
- **Server Actions** when service-role privileges or atomic multi-row writes are
  needed (creating a deal), or when the write should run as the user under RLS
  (changing a deal's stage).

### Data model

```
auth.users (Supabase built-in)
   │
   ├─< deal_members (deal_id, user_id, role: lead | member | viewer)   ← isolation join
   │
deals (stage: preparation | marketing_cim | buyer_gtm | detailed_dd | close)
   │
   └─< milestones (due_date, status: pending | done | skipped)
```

Authorization is entirely Postgres RLS: deal-scoped policies call
`is_deal_member(deal_id)`, so a user only ever sees or edits deals they are a
member of. `createDeal` is the single place the service-role client is used — to
insert the creator's `deal_members` row (there is intentionally no INSERT policy
on that table) — and it is confined to that one server-only action.

## Getting started

### Prerequisites

- Node 20+ and **pnpm** (`corepack enable` or `npm i -g pnpm`)
- **Docker** running (the Supabase local stack runs in containers)
- Supabase CLI is installed as a dev dependency (`pnpm exec supabase …`)

### Setup

```bash
pnpm install

# Start the local Supabase stack (Postgres, Auth, Storage, Studio, Mailpit).
# First run pulls images and can take a few minutes.
pnpm supabase:start

# Apply migrations + seed the demo data.
pnpm exec supabase db reset

# Create .env.local from the template, then paste the anon + service_role keys
# printed by `supabase start` (or `pnpm supabase:status`).
cp .env.example .env.local

# Run the app.
pnpm dev
```

Open <http://localhost:3000> — you'll be redirected to `/sign-in`. Sign in with a
magic link: submit any email, then open the message in Mailpit at
<http://127.0.0.1:54324> and click the link.

`.env.local` (gitignored) holds:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase start>
SUPABASE_SERVICE_ROLE_KEY=<from supabase start>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

> The local Supabase keys are well-known development defaults — never commit real
> keys. Only `.env.example` (blank values) is tracked.

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Run the dev server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (unit + integration; loads `.env.local`) |
| `pnpm test:watch` / `pnpm test:coverage` | Watch / coverage |
| `pnpm e2e` / `pnpm e2e:ui` | Playwright E2E |
| `pnpm supabase:start` / `:stop` / `:status` | Manage the local stack |
| `pnpm supabase:reset` | Reapply migrations + seed |

## Project structure

Organized by feature/surface, not by file type.

```
app/
├── page.tsx                         redirect / → /deals
├── layout.tsx, globals.css          root layout + Tailwind
├── api/health/route.ts              liveness check (public)
├── auth/callback/route.ts           magic-link PKCE exchange
├── (marketing)/                     public auth pages
│   ├── layout.tsx
│   └── sign-in/{page.tsx, actions.ts}
└── (app)/                           protected shell (requireUser gate)
    ├── layout.tsx                   header + sign-out
    ├── sign-out/route.ts
    └── deals/
        ├── page.tsx                 deal list
        ├── actions.ts               createDeal (service role)
        └── [id]/                    deal workspace
            ├── layout.tsx           loads deal (RLS → notFound), header + tabs
            ├── page.tsx             Overview (milestones, stage, activity)
            ├── actions.ts           updateStage (RLS-gated)
            ├── buyers/page.tsx      stub (Phase 4)
            └── qa/page.tsx          stub (Phase 3)

components/
├── deal/    DealList, CreateDealForm, DealHeader, DealTabs,
│            StageSelector, MilestoneList, ActivityFeed
└── ui/      Button, Input, Select, Surface

lib/
├── auth.ts                 requireUser()
├── milestone.ts            dueSoon() / DUE_SOON_DAYS
└── supabase/               client (browser), server (RSC/actions), service (admin)

middleware.ts               auth gate / session refresh

supabase/
├── config.toml
├── seed.sql                demo user + "Project Atlas"
└── migrations/
    ├── …_initial_schema.sql       deals, deal_members, milestones, pgvector
    ├── …_rls_policies.sql         RLS + is_deal_member()
    └── …_deal_activity_view.sql   activity view (empty until Phase 3/4)

tests/
├── integration/   RLS proofs, action patterns, component + unit tests
├── helpers/        supabase-test.ts (test clients, createTestUser, resetDb)
└── e2e/            auth + deal-pm golden paths, Mailpit helper
```

### Feature → file map

| Feature | Key files |
|---------|-----------|
| Magic-link auth | `app/(marketing)/sign-in/*`, `app/auth/callback/route.ts`, `app/(app)/sign-out/route.ts`, `middleware.ts`, `lib/auth.ts` |
| Supabase clients | `lib/supabase/{client,server,service}.ts` |
| Deal list & create | `app/(app)/deals/page.tsx`, `components/deal/{DealList,CreateDealForm}.tsx`, `app/(app)/deals/actions.ts` |
| Deal workspace | `app/(app)/deals/[id]/layout.tsx`, `components/deal/{DealHeader,DealTabs}.tsx` |
| Stage tracking | `components/deal/StageSelector.tsx`, `app/(app)/deals/[id]/actions.ts` |
| Milestones | `components/deal/MilestoneList.tsx`, `lib/milestone.ts` |
| Activity feed | `components/deal/ActivityFeed.tsx`, `supabase/migrations/…_deal_activity_view.sql` |
| Schema & RLS | `supabase/migrations/*`, `supabase/seed.sql` |

## Testing

- **Unit / integration (Vitest):** runs against the live local Supabase stack
  (so the local stack must be running). Includes RLS isolation proofs and
  Server-Action behavior. `pnpm test`.
- **E2E (Playwright):** drives the real app + Supabase + Mailpit through the
  magic-link sign-in and the Deal PM golden path. `pnpm e2e`.

Tests share a single local database, so the Vitest config runs test files
serially (`fileParallelism: false`) and each test resets state in `beforeEach`.

## CI

`.github/workflows/ci.yml` runs on PRs and pushes to `master`/`main`: install →
`pnpm lint` → `tsc --noEmit` → start Supabase → `pnpm test`.

## Build phases

- **Phase 1 — Foundation:** ✅ Next.js + Supabase, schema + RLS, magic-link auth, CI
- **Phase 2 — Deal PM shell:** ✅ deal list, workspace, stage, milestones, activity
- **Phase 3 — DD Q&A RAG:** ⏳ planned (pgvector + the `deal_activity` view are ready)
- **Phase 4 — Buyers + IMAP:** ⏳ planned

See `plans/oss-app/2026-05-28-phase-1-2-foundation-deal-pm.md` for the Phase 1+2
plan and `specs/oss-app/` for the design. `CLAUDE.md` is the working brief for
agents; `process.md` is the M&A domain vocabulary primer.
