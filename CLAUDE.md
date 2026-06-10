# Solomon Partners Sell-Side M&A Platform

This repo holds a sell-side M&A platform being built for Solomon Partners. Phase 1 + Phase 2 are implemented on a Next.js 16 + Supabase stack. This CLAUDE.md must be kept in sync with the shipped code; see the Module map section for the current layout.

## Read this first

Before proposing anything domain-shaped, read `process.md`. It is the banker-workflow vocabulary primer covering the 5-phase sell-side M&A process (Preparation → Marketing/CIM → Buyer GTM → Detailed Diligence → Close) and the key terms: CIM, IOI, LOI, VDR, NDA, and others. Proposals that misuse these terms or misread the process will be rejected.

## Spec hierarchy

- `specs/code-app/2026-05-20-sell-side-ma-platform-code-app-design.md` — authoritative architecture spec. This is the source of truth for all technical decisions.
- `specs/code-app/deal-pm-phase2-design.md` — Phase 2 slice (Deal PM shell). Derived from the main spec; the main spec wins on any conflict.
- `specs/canvas-app/2026-05-19-sell-side-ma-platform-design.md` — trade-off artifact. The Code App path was chosen over Canvas App. Read this for the reasoning behind that decision, not for what to build.
- Every `.md` spec has a rendered `.html` twin. Never edit the HTML files; the `.md` is always the source of truth.

## Module map and build phases

Phase 1 + Phase 2 are implemented. Source layout:

- `app/` — Next.js 16 App Router. Protected routes under `(app)/`, marketing under `(marketing)/`.
- `components/deal/` — DealList, StageSelector, MilestoneList, ActivityFeed, etc.
- `components/ui/` — Button, Input, Select, Surface primitives.
- `lib/supabase/` — browser, server, and service-role clients.
- `lib/llm.ts` — provider-agnostic LLM (Gemini default); `lib/rag/` — chunk, prompt, ingest.
- `inngest/` — Inngest client + `doc.ingest` workflow; `app/api/inngest/route.ts` is the webhook.
- `app/api/deals/[id]/qa/` — RAG query route (`route.ts`) + testable core (`answer.ts`); `app/(app)/deals/[id]/qa/` — DD Q&A tab page + `uploadDocument` action (`actions.ts`) + `storage-path.ts` helper.
- `components/deal/` — DocumentUpload, DocumentList, QAPanel (Phase 3).
- `lib/auth.ts` — `requireUser()` helper used by protected layouts; `lib/auth/validation.ts` + `lib/auth/safe-next.ts` — auth input validation and redirect guard.
- `app/(marketing)/sign-in`, `sign-up`, `forgot-password`, `reset-password` — email + password auth pages and their server actions; `app/auth/callback/route.ts` handles email-confirmation and password-recovery links.
- `supabase/migrations/` — versioned schema and RLS migrations.
- `supabase/seed.sql` — local-dev seed.
- `tests/integration/` — Vitest against local Supabase (RLS proofs, action behavior).
- `tests/e2e/` — Playwright golden paths.

Phase build status:

- Phase 1 (Foundation): ✅ shipped — see `plans/oss-app/2026-05-28-phase-1-2-foundation-deal-pm.md`
- Phase 2 (Deal PM shell): ✅ shipped — same plan
- Phase 3 (DD Q&A RAG): ✅ shipped — see `plans/oss-app/2026-06-03-phase-3-dd-qa-rag.md`
- Phase 4 (Buyers + IMAP): ⏳ separate plan to be drafted
- Phase 5 (Polish): optional

## Stack constraints

- Frontend: Next.js 16 App Router (TypeScript strict), Tailwind CSS 4, hosted on Vercel.
- Backend: Next.js Server Actions and Route Handlers. No separate API server.
- Auth: Supabase Auth (email + password with self-service sign-up and required email confirmation). Middleware in `middleware.ts` redirects unauthenticated users to `/sign-in`.
- State: Supabase Postgres. Deal isolation enforced by RLS keyed off `deal_members(deal_id, user_id)`.
- pgvector extension is enabled on day one for use in Phase 3.
- The frontend talks to Supabase directly for simple CRUD (RLS gates access). Server Actions are used when service-role privileges or atomic multi-row writes are required.
- CI/CD: GitHub Actions. PR gate runs lint, type-check, and Vitest. E2E runs on pushes to main.
- DD Q&A (Phase 3) requires the Inngest dev server (`pnpm inngest:dev`) and a `GEMINI_API_KEY` for local document ingestion and RAG. The Inngest webhook route `/api/inngest` is public (bypasses auth middleware) since Inngest authenticates with its own signing key.

## Resolved decisions — do not reopen

- Open-source stack chosen over the Microsoft Code App path. See `specs/oss-app/2026-05-28-sell-side-ma-platform-oss-design.md`.
- Supabase is the backend platform (Postgres + Auth + Storage + pgvector).
- Deal isolation = Postgres RLS via `deal_members`. No Business Units, no OBO.
- Activity feed page limit = 10. Milestone "Due Soon" = 5 days. Buyer follow-up overdue = 14 days (used in Phase 4).

## Open questions

- VDR staging automation (deferred until Phase 4 polish): same options as the original spec — Intralinks / Datasite / Ansarada APIs. Manual upload to Supabase Storage is the v1 pattern.
- Real buyer data source: Crunchbase / Apollo / public filings — integration point is `step "gather_context"` of the Phase 4 `buyer.generate` Inngest workflow.

## Cross-platform working note

The repo lives in OneDrive and is opened from two machines:

- Mac: `/Users/admin/Library/CloudStorage/OneDrive-Personal/Bryan_Docs/Tech/Personal_projects/ms-code-app`
- Windows: `C:\Users\Bryan.Xiao\OneDrive - Solomon Partners, L.P\Bryan_Docs\Projects_Code\Sellside-MA`

`.claude/settings.local.json` contains a Windows-only PowerShell `Start-Process` permission scoped to opening the prototype HTML from the Windows OneDrive path. Mac sessions should not add or modify that permission, and should not propose adding a Mac equivalent unless asked.

## Current repo state

Phase 1 + Phase 2 source code now exists (Next.js 16 + Supabase, with `package.json`, `tsconfig.json`, lint config, and Vitest/Playwright suites). See the Module map section for the layout. Other notable files:

- `process.md` — domain vocabulary and banker workflow primer.
- `specs/` — design specs and their rendered HTML exports.
- `prototypes/deal-pm-phase2-ui.html` — the latest Phase 2 UI mockup as of 2026-05-28, subject to iteration.
- `.claude/settings.local.json` — local Claude permissions (Windows-only entry).

As later phases land, keep the Module map section of this file in sync with the actual directory structure.
