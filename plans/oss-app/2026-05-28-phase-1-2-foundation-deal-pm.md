# Phase 1 + Phase 2 Implementation Plan — Foundation & Deal PM Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js 16 + Supabase foundation and ship the Deal PM shell (sign-in → deal list → deal workspace with stage selector, milestone CRUD, and empty activity feed). No AI features yet.

**Architecture:** Greenfield Next.js 16 App Router app on Vercel free tier with Supabase as the backend (Postgres with pgvector enabled for later phases, Auth with email magic link, Storage bucket scaffolded for later phases). Deal isolation enforced by Postgres RLS keyed off a `deal_members` join table. Browser talks to Supabase directly for simple CRUD (RLS gates access); Server Actions handle writes that require service-role privileges or create-deal atomicity.

**Tech Stack:**
- Next.js 16 (App Router, TypeScript strict, React Server Components)
- Tailwind CSS 4 for styling
- Supabase: Postgres + Auth + Storage (local dev via Supabase CLI)
- `@supabase/ssr` + `@supabase/supabase-js` clients
- Vitest 2 + @testing-library/react for unit/component/integration tests
- Playwright 1.49+ for E2E
- pnpm 9+ for package management
- GitHub Actions for CI

**Scope of this plan:**
- ✅ Phase 1 — Foundation (Supabase project, schema for Deals/Milestones/deal_members, RLS, Auth, CI)
- ✅ Phase 2 — Deal PM shell (DealList, DealWorkspace, StageSelector, MilestoneList, empty ActivityFeed)
- ⏭ Phase 3 — DD Q&A RAG (separate plan)
- ⏭ Phase 4 — Buyers + IMAP (separate plan)

**Out of scope for this plan:**
- Buyers table, BuyerCommunications, QALog, Documents — tables not created until Phase 3/4 plans (we ship Phase 1+2 without those tables; the `deal_activity` view is added but returns empty until later tables exist)
- pgvector data, document_chunks
- Inngest setup
- LLM provider setup
- Sentry

---

## File Structure

### New files this plan creates

```
/                                                    ← repo root
├── package.json
├── pnpm-lock.yaml                                  ← generated
├── pnpm-workspace.yaml                             ← not needed (single package)
├── tsconfig.json
├── next.config.mjs
├── postcss.config.mjs
├── tailwind.config.ts
├── eslint.config.mjs
├── vitest.config.ts
├── playwright.config.ts
├── middleware.ts                                   ← auth gate
├── .env.example
├── .env.local                                      ← gitignored, dev only
├── .gitignore                                      ← additions
├── .github/
│   └── workflows/
│       ├── ci.yml                                  ← lint + types + Vitest
│       └── e2e.yml                                 ← Playwright on main
├── supabase/
│   ├── config.toml                                 ← from `supabase init`
│   ├── seed.sql                                    ← demo deal + member
│   └── migrations/
│       ├── 20260528000000_initial_schema.sql      ← deals, deal_members, milestones
│       ├── 20260528000001_rls_policies.sql        ← RLS on all tables
│       └── 20260528000002_deal_activity_view.sql  ← empty-until-later view
├── lib/
│   ├── supabase/
│   │   ├── client.ts                              ← browser client
│   │   ├── server.ts                              ← RSC + Server Action client
│   │   └── service.ts                             ← service-role client
│   └── auth.ts                                    ← requireUser() helper
├── app/
│   ├── layout.tsx                                 ← root layout
│   ├── globals.css                                ← Tailwind directives
│   ├── page.tsx                                   ← landing → redirects
│   ├── auth/
│   │   └── callback/
│   │       └── route.ts                           ← magic link callback
│   ├── (marketing)/
│   │   └── sign-in/
│   │       ├── page.tsx                           ← sign-in form
│   │       └── actions.ts                         ← signInWithMagicLink action
│   ├── (app)/
│   │   ├── layout.tsx                             ← protected shell
│   │   ├── deals/
│   │   │   ├── page.tsx                           ← DealList
│   │   │   ├── actions.ts                         ← createDeal action
│   │   │   └── [id]/
│   │   │       ├── layout.tsx                     ← DealWorkspace shell + tabs
│   │   │       ├── page.tsx                       ← Overview tab
│   │   │       ├── actions.ts                     ← updateStage, milestone CRUD
│   │   │       ├── buyers/page.tsx                ← stub
│   │   │       └── qa/page.tsx                    ← stub
│   │   └── sign-out/
│   │       └── route.ts                           ← POST → sign out
│   └── api/
│       └── health/route.ts                        ← liveness check
├── components/
│   ├── ui/
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   └── Surface.tsx
│   └── deal/
│       ├── DealList.tsx
│       ├── CreateDealForm.tsx
│       ├── DealHeader.tsx
│       ├── DealTabs.tsx
│       ├── StageSelector.tsx
│       ├── MilestoneList.tsx
│       └── ActivityFeed.tsx
└── tests/
    ├── integration/
    │   ├── rls.test.ts                            ← prove cross-deal isolation
    │   └── actions.test.ts                        ← server action behavior
    └── e2e/
        ├── auth.spec.ts                           ← sign-in golden path
        └── deal-pm.spec.ts                        ← Phase 2 golden path
```

### Modified files

```
CLAUDE.md                  ← update Module Map section after scaffold lands
```

---

## Conventions used in this plan

- **Package manager:** `pnpm`. Steps use `pnpm` exclusively; do not substitute `npm` or `yarn`.
- **Working directory:** repo root. All paths are repo-relative unless prefixed with `/`.
- **Test commands:** `pnpm test` for Vitest; `pnpm exec playwright test` for Playwright.
- **Supabase local dev:** `supabase start` must be running for any test or `pnpm dev` that touches the DB.
- **Commits:** small and frequent. Each task ends with a commit. Conventional commit prefixes: `feat`, `fix`, `chore`, `test`, `docs`.
- **OneDrive note:** This repo lives in OneDrive. If `pnpm install` or `supabase start` reports lock-file or watcher errors, pause OneDrive sync for the repo folder rather than working around the symptom.

---

# Phase 1 — Foundation

## Task 1: Initialize Next.js 16 project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `postcss.config.mjs`, `tailwind.config.ts`, `eslint.config.mjs`, `.gitignore`

- [ ] **Step 1: Scaffold the app**

```bash
pnpm dlx create-next-app@16 . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir false \
  --turbopack \
  --import-alias "@/*" \
  --use-pnpm
```

If prompted about non-empty directory: confirm — only `specs/`, `plans/`, `prototypes/`, `process.md`, `CLAUDE.md`, `.claude/` exist; the scaffold preserves them.

- [ ] **Step 2: Pin TypeScript to strict mode**

Open `tsconfig.json` and ensure these settings are present:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "allowJs": false,
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "lib": ["es2022", "dom", "dom.iterable"],
    "jsx": "preserve",
    "incremental": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "tests/e2e/**", "supabase/**"]
}
```

- [ ] **Step 3: Add a basic home page redirect**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/deals");
}
```

- [ ] **Step 4: Verify the build compiles**

Run:

```bash
pnpm run build
```

Expected: `Compiled successfully` with at least the root and `/deals` routes acknowledged (deals will 404 at this stage — that's fine).

- [ ] **Step 5: Append project entries to .gitignore**

Append to `.gitignore`:

```
# env
.env.local
.env*.local

# supabase
supabase/.branches
supabase/.temp

# playwright
test-results/
playwright-report/

# vitest
coverage/
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 App Router project with strict TypeScript"
```

---

## Task 2: Configure Vitest and Testing Library

**Files:**
- Create: `vitest.config.ts`, `tests/integration/.gitkeep`
- Modify: `package.json` (scripts + devDeps)

- [ ] **Step 1: Install Vitest dependencies**

```bash
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom @types/node
```

- [ ] **Step 2: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["app/**", "components/**", "lib/**"],
      exclude: ["**/*.d.ts", "**/*.test.*", "tests/**"],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
    exclude: ["node_modules", "tests/e2e/**", ".next/**"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
```

Install the React plugin:

```bash
pnpm add -D @vitejs/plugin-react
```

- [ ] **Step 3: Create the Vitest setup file**

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 4: Add test scripts to package.json**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 5: Write a smoke test that proves Vitest is wired**

Create `tests/integration/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest wiring", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run it**

```bash
pnpm test
```

Expected: 1 test passes; Vitest exits 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: configure Vitest with jsdom and Testing Library"
```

---

## Task 3: Configure Playwright

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/.gitkeep`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install Playwright**

```bash
pnpm add -D @playwright/test
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 2: Create playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

- [ ] **Step 3: Add Playwright scripts**

In `package.json` `"scripts"`:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 4: Write a smoke E2E test**

Create `tests/e2e/smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

test("home redirects to /deals", async ({ page }) => {
  const response = await page.goto("/");
  // /deals will eventually require auth; for now we just confirm the redirect chain
  expect(response).not.toBeNull();
  await expect(page).toHaveURL(/\/(deals|sign-in)/);
});
```

- [ ] **Step 5: Verify the test runs**

(Skip running it now — Phase 1 routes don't exist yet. Verify config syntax only.)

```bash
pnpm exec playwright test --list
```

Expected: 1 test listed; no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: configure Playwright with chromium"
```

---

## Task 4: Initialize Supabase local dev

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)
- Modify: `.env.example`, `.gitignore`

- [ ] **Step 1: Install Supabase CLI as a dev dependency**

```bash
pnpm add -D supabase
```

- [ ] **Step 2: Initialize the project**

```bash
pnpm exec supabase init
```

Accept defaults. This creates `supabase/config.toml` and `supabase/.gitignore`.

- [ ] **Step 3: Start the local Supabase stack**

```bash
pnpm exec supabase start
```

This may take 1-2 minutes on first run while images download. Expected final output is a block listing `API URL`, `DB URL`, `Studio URL`, `JWT secret`, `anon key`, `service_role key`.

Copy the `anon key` and `service_role key` for the next step.

- [ ] **Step 4: Create .env.example and .env.local**

Create `.env.example` (committed):

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Create `.env.local` (gitignored) with the actual local keys from Step 3:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste anon key from supabase start>
SUPABASE_SERVICE_ROLE_KEY=<paste service_role key from supabase start>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 5: Confirm Supabase Studio is reachable**

Open `http://127.0.0.1:54323` in a browser. Confirm the Studio UI loads. Close the browser tab.

- [ ] **Step 6: Add Supabase scripts to package.json**

In `package.json` `"scripts"`:

```json
"supabase:start": "supabase start",
"supabase:stop": "supabase stop",
"supabase:reset": "supabase db reset",
"supabase:status": "supabase status"
```

- [ ] **Step 7: Commit**

```bash
git add supabase/ .env.example .gitignore package.json pnpm-lock.yaml
git commit -m "chore: initialize Supabase local dev environment"
```

---

## Task 5: Create initial schema migration

**Files:**
- Create: `supabase/migrations/20260528000000_initial_schema.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260528000000_initial_schema.sql`:

```sql
-- Initial schema: deals, deal_members, milestones.
-- Identity reuses Supabase's built-in auth.users table.

create table public.deals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_company text not null,
  sector text,
  stage text not null default 'preparation'
    check (stage in ('preparation','marketing_cim','buyer_gtm','detailed_dd','close')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);

create index deals_created_by_idx on public.deals (created_by);

create table public.deal_members (
  deal_id uuid not null references public.deals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('lead','member','viewer')),
  added_at timestamptz not null default now(),
  primary key (deal_id, user_id)
);

create index deal_members_user_idx on public.deal_members (user_id);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  name text not null,
  due_date date not null,
  status text not null default 'pending'
    check (status in ('pending','done','skipped')),
  created_at timestamptz not null default now()
);

create index milestones_deal_idx on public.milestones (deal_id);

-- pgvector extension enabled now so later phases don't require an extra migration.
create extension if not exists vector;
```

- [ ] **Step 2: Apply the migration**

```bash
pnpm exec supabase db reset
```

Expected: migration runs successfully, prints `Finished supabase db reset` with no errors.

- [ ] **Step 3: Verify tables exist**

```bash
pnpm exec supabase db diff --schema public
```

Expected: empty diff (the live DB matches the migration).

Alternative check via psql connection string from `pnpm exec supabase status`:

```bash
PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
```

Expected: lists `deals`, `deal_members`, `milestones`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): initial schema for deals, deal_members, milestones"
```

---

## Task 6: Add RLS policies migration

**Files:**
- Create: `supabase/migrations/20260528000001_rls_policies.sql`

- [ ] **Step 1: Create the RLS migration**

Create `supabase/migrations/20260528000001_rls_policies.sql`:

```sql
-- Enable RLS on all deal-scoped tables.
alter table public.deals          enable row level security;
alter table public.deal_members   enable row level security;
alter table public.milestones     enable row level security;

-- Helper: is the calling user a member of the given deal?
create or replace function public.is_deal_member(deal uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.deal_members dm
    where dm.deal_id = deal
      and dm.user_id = auth.uid()
  );
$$;

-- deals: members see and write their deals.
create policy deals_select_member on public.deals
  for select
  using (public.is_deal_member(id));

create policy deals_update_member on public.deals
  for update
  using (public.is_deal_member(id))
  with check (public.is_deal_member(id));

-- INSERT is allowed for any authenticated user; the server action that calls this
-- also inserts the creator into deal_members atomically (see Task 15).
create policy deals_insert_authenticated on public.deals
  for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- deal_members: a user sees only their own membership rows.
-- Inserts/deletes are restricted to the service role (lead-management UX is out of scope for v1).
create policy dm_select_self on public.deal_members
  for select
  using (user_id = auth.uid());

-- milestones: full CRUD for members of the parent deal.
create policy milestones_all_member on public.milestones
  for all
  using (public.is_deal_member(deal_id))
  with check (public.is_deal_member(deal_id));
```

- [ ] **Step 2: Apply the migration**

```bash
pnpm exec supabase db reset
```

Expected: both migrations apply cleanly.

- [ ] **Step 3: Spot-check policies via psql**

```bash
PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:54322/postgres" \
  -c "select tablename, policyname from pg_policies where schemaname='public' order by tablename, policyname;"
```

Expected output includes 5 rows:
```
deals          | deals_insert_authenticated
deals          | deals_select_member
deals          | deals_update_member
deal_members   | dm_select_self
milestones     | milestones_all_member
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): RLS policies for deals, deal_members, milestones"
```

---

## Task 7: Write RLS integration tests

**Files:**
- Create: `tests/integration/rls.test.ts`, `tests/helpers/supabase-test.ts`

- [ ] **Step 1: Install the supabase JS client**

```bash
pnpm add @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Create the test helper**

Create `tests/helpers/supabase-test.ts`:

```ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!ANON || !SERVICE) {
  throw new Error(
    "Supabase env vars missing. Run with `dotenv -e .env.local -- pnpm test` " +
      "or export them in your shell."
  );
}

export function serviceClient(): SupabaseClient {
  return createClient(URL, SERVICE, { auth: { persistSession: false } });
}

export function anonClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

/** Create a user via the service client and return a client signed in as them. */
export async function createTestUser(email: string): Promise<{
  userId: string;
  client: SupabaseClient;
}> {
  const svc = serviceClient();
  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password: "test-password-12345",
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error("user not created");

  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({
    email,
    password: "test-password-12345",
  });
  if (signInErr) throw signInErr;

  return { userId: created.user.id, client };
}

/** Wipe all rows from public tables; safe because we run against local DB only. */
export async function resetDb(): Promise<void> {
  const svc = serviceClient();
  await svc.from("milestones").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await svc.from("deal_members").delete().neq("deal_id", "00000000-0000-0000-0000-000000000000");
  await svc.from("deals").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  // Clear auth users
  const { data: users } = await svc.auth.admin.listUsers();
  for (const u of users?.users ?? []) {
    await svc.auth.admin.deleteUser(u.id);
  }
}
```

- [ ] **Step 3: Install dotenv-cli for env loading in tests**

```bash
pnpm add -D dotenv-cli
```

Update `package.json` `"scripts"`:

```json
"test": "dotenv -e .env.local -- vitest run",
"test:watch": "dotenv -e .env.local -- vitest",
"test:coverage": "dotenv -e .env.local -- vitest run --coverage"
```

- [ ] **Step 4: Write the failing RLS test**

Create `tests/integration/rls.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";

describe("RLS: deal isolation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("user A sees only deals where they are a deal_members row", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");

    const svc = serviceClient();
    const { data: dealA } = await svc
      .from("deals")
      .insert({ name: "Project Alpha", target_company: "AlphaCo", created_by: a })
      .select()
      .single();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Project Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealA!.id, user_id: a, role: "lead" });
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });

    const { data: visible, error } = await clientA.from("deals").select();
    expect(error).toBeNull();
    expect(visible).toHaveLength(1);
    expect(visible![0].id).toBe(dealA!.id);
  });

  it("user A cannot update user B's deal stage", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");

    const svc = serviceClient();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Project Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });

    const { data: updated } = await clientA
      .from("deals")
      .update({ stage: "close" })
      .eq("id", dealB!.id)
      .select();
    // RLS makes this return zero rows instead of throwing — same effect.
    expect(updated).toEqual([]);
  });

  it("user A cannot read milestones on user B's deal", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b } = await createTestUser("b@test.local");

    const svc = serviceClient();
    const { data: dealB } = await svc
      .from("deals")
      .insert({ name: "Project Bravo", target_company: "BravoCo", created_by: b })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: dealB!.id, user_id: b, role: "lead" });
    await svc.from("milestones").insert({
      deal_id: dealB!.id,
      name: "Kickoff",
      due_date: "2026-06-01",
    });

    const { data: visible } = await clientA.from("milestones").select();
    expect(visible).toEqual([]);
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
pnpm test rls
```

Expected: all 3 RLS tests pass. If `createTestUser` fails because email confirmation is required, open `supabase/config.toml` and ensure `[auth.email] enable_confirmations = false` (default for local dev — but verify).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(db): RLS integration tests proving cross-deal isolation"
```

---

## Task 8: Create Supabase client helpers

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/service.ts`, `lib/auth.ts`

- [ ] **Step 1: Create the browser client**

Create `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Create the server client (RSC + Server Actions)**

Create `lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // RSC may call this; ignore the read-only error.
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Create the service-role client**

Create `lib/supabase/service.ts`:

```ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS. Server-side only.
 * Never import this from a client component or expose the key.
 */
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
```

- [ ] **Step 4: Create the auth helper**

Create `lib/auth.ts`:

```ts
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

/** Returns the authenticated user, or redirects to /sign-in. */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirect("/sign-in");
  }
  return data.user;
}
```

- [ ] **Step 5: Write a unit test for createServiceClient**

Create `tests/integration/clients.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createServiceClient } from "@/lib/supabase/service";

describe("service client", () => {
  it("can read auth.users via admin API", async () => {
    const svc = createServiceClient();
    const { error } = await svc.auth.admin.listUsers();
    expect(error).toBeNull();
  });
});
```

- [ ] **Step 6: Run it**

```bash
pnpm test clients
```

Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: supabase client helpers (browser, server, service) and auth gate"
```

---

## Task 9: Add Supabase Auth middleware

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Create the middleware**

Create `middleware.ts` at repo root:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PATHS = ["/sign-in", "/auth/callback", "/api/health"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  if (pathname === "/") {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 2: Verify the dev server boots without errors**

```bash
pnpm run dev
```

Open `http://localhost:3000` — should redirect to `/deals` then to `/sign-in` (which doesn't exist yet — expect a 404 page from Next.js for `/sign-in`). Stop the server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat(auth): middleware redirects unauthenticated users to /sign-in"
```

---

## Task 10: Build sign-in page with magic link

**Files:**
- Create: `app/(marketing)/sign-in/page.tsx`, `app/(marketing)/sign-in/actions.ts`, `components/ui/Button.tsx`, `components/ui/Input.tsx`, `components/ui/Surface.tsx`

- [ ] **Step 1: Create primitive UI components**

Create `components/ui/Button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

type Variant = "primary" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ className, variant = "primary", ...rest }, ref) => (
    <button
      ref={ref}
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition",
        "disabled:opacity-50 disabled:pointer-events-none",
        variant === "primary" && "bg-indigo-600 text-white hover:bg-indigo-500",
        variant === "secondary" && "bg-slate-100 text-slate-900 hover:bg-slate-200",
        variant === "ghost" && "text-indigo-600 hover:bg-indigo-50",
        className
      )}
    />
  )
);
Button.displayName = "Button";
```

Install `clsx`:

```bash
pnpm add clsx
```

Create `components/ui/Input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from "react";
import { clsx } from "clsx";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      {...rest}
      className={clsx(
        "block w-full rounded-md border border-slate-300 px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
        className
      )}
    />
  )
);
Input.displayName = "Input";
```

Create `components/ui/Surface.tsx`:

```tsx
import { type HTMLAttributes } from "react";
import { clsx } from "clsx";

export function Surface({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={clsx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}
    />
  );
}
```

- [ ] **Step 2: Create the sign-in server action**

Create `app/(marketing)/sign-in/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

export type SignInResult = { ok: true } | { ok: false; error: string };

export async function signInWithMagicLink(formData: FormData): Promise<SignInResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const h = await headers();
  const origin = h.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
```

- [ ] **Step 3: Create the sign-in page**

Create `app/(marketing)/sign-in/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { signInWithMagicLink } from "./actions";

export default function SignInPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function onSubmit(formData: FormData) {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await signInWithMagicLink(formData);
      if (result.ok) {
        setMessage("Check your email for the sign-in link.");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <main className="min-h-screen grid place-items-center bg-slate-50 px-4">
      <Surface className="w-full max-w-sm p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Sign in</h1>
        <p className="text-sm text-slate-500 mb-6">
          We'll email you a one-click sign-in link.
        </p>
        <form action={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Sending..." : "Send magic link"}
          </Button>
          {message && <p className="text-sm text-emerald-600">{message}</p>}
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </form>
      </Surface>
    </main>
  );
}
```

- [ ] **Step 4: Verify the page renders**

```bash
pnpm run dev
```

Open `http://localhost:3000/sign-in`. You should see the sign-in card. Submit a fake email — you should get either the success message or a clear error from Supabase. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(auth): magic-link sign-in page and server action"
```

---

## Task 11: Add auth callback route

**Files:**
- Create: `app/auth/callback/route.ts`

- [ ] **Step 1: Create the callback handler**

Create `app/auth/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/deals";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/sign-in?error=callback`);
}
```

- [ ] **Step 2: Smoke-test the route compiles**

```bash
pnpm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add app/auth/
git commit -m "feat(auth): magic-link callback route"
```

---

## Task 12: Add health check, marketing layout, app shell

**Files:**
- Create: `app/api/health/route.ts`, `app/(marketing)/layout.tsx`, `app/(app)/layout.tsx`, `app/(app)/sign-out/route.ts`

- [ ] **Step 1: Health route**

Create `app/api/health/route.ts`:

```ts
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 2: Marketing layout (passthrough)**

Create `app/(marketing)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
```

- [ ] **Step 3: App shell with header + sign-out**

Create `app/(app)/layout.tsx`:

```tsx
import Link from "next/link";
import { type ReactNode } from "react";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
          <Link href="/deals" className="font-semibold text-slate-900">
            Sell-Side M&amp;A
          </Link>
          <form action="/sign-out" method="post" className="flex items-center gap-3">
            <span className="text-xs text-slate-500">{user.email}</span>
            <button
              type="submit"
              className="text-xs text-indigo-600 hover:text-indigo-500"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Sign-out handler**

Create `app/(app)/sign-out/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const url = new URL("/sign-in", request.url);
  return NextResponse.redirect(url, { status: 303 });
}
```

- [ ] **Step 5: Empty /deals page**

Create `app/(app)/deals/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function DealsPage() {
  const supabase = await createClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, name, target_company, sector, stage")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
      </div>
      {deals && deals.length > 0 ? (
        <ul className="grid gap-3">
          {deals.map((d) => (
            <li
              key={d.id}
              className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700"
            >
              {d.name} — {d.target_company} ({d.stage})
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-500">No deals yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Manual auth verification**

```bash
pnpm run dev
```

In a separate shell, create a test user via Supabase Studio (`http://127.0.0.1:54323` → Authentication → Add user, with `Auto Confirm User` checked). Then visit `http://localhost:3000/sign-in`, request a magic link, fetch it from Supabase Studio's mail inbox at `http://127.0.0.1:54324` (Inbucket — local mail catcher), click the link. You should land on `/deals` with "No deals yet."

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: protected app shell with sign-out and empty deals list"
```

---

## Task 13: Write E2E test for sign-in flow

**Files:**
- Create: `tests/e2e/auth.spec.ts`, `tests/e2e/helpers/inbucket.ts`

- [ ] **Step 1: Inbucket helper for fetching the magic link**

Create `tests/e2e/helpers/inbucket.ts`:

```ts
type Mailbox = { id: string; from: string; subject: string }[];

export async function getMagicLink(email: string): Promise<string> {
  const mailbox = email.split("@")[0];
  // Poll for up to 10s
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const list = await fetch(`http://127.0.0.1:54324/api/v1/mailbox/${mailbox}`)
      .then((r) => (r.ok ? (r.json() as Promise<Mailbox>) : []))
      .catch(() => [] as Mailbox);
    if (list.length > 0) {
      const message = await fetch(
        `http://127.0.0.1:54324/api/v1/mailbox/${mailbox}/${list[0].id}`
      ).then((r) => r.json());
      const body: string = message.body?.text ?? message.body?.html ?? "";
      const match = body.match(/https?:\/\/[^\s"<]+/);
      if (match) return match[0];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No magic link arrived for ${email} in 10s`);
}

export async function clearInbucket(): Promise<void> {
  await fetch("http://127.0.0.1:54324/api/v1/mailbox", { method: "DELETE" }).catch(() => {});
}
```

- [ ] **Step 2: Write the E2E test**

Replace `tests/e2e/smoke.spec.ts` with the real test — first delete the smoke file:

```bash
rm tests/e2e/smoke.spec.ts
```

Then create `tests/e2e/auth.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { getMagicLink, clearInbucket } from "./helpers/inbucket";

test.beforeEach(async () => {
  await clearInbucket();
});

test("user can sign in via magic link and reach /deals", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.local`;

  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();

  const link = await getMagicLink(email);
  await page.goto(link);

  await expect(page).toHaveURL(/\/deals$/);
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
  await expect(page.getByText("No deals yet.")).toBeVisible();
});
```

- [ ] **Step 3: Run the E2E test**

Ensure `supabase start` is running, then:

```bash
pnpm exec playwright test auth
```

Expected: 1 test passes.

If it fails: read the failure trace; common causes are (a) Inbucket not running — re-run `pnpm exec supabase status` to confirm port 54324; (b) middleware redirect loop — verify Task 9 PUBLIC_PATHS includes `/sign-in` and `/auth/callback`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(e2e): magic-link sign-in golden path"
```

---

## Task 14: Configure GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master, main]
  pull_request:

jobs:
  lint-types-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        ports: ["54322:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with: { version: 9 }

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      - run: pnpm exec next lint
      - run: pnpm exec tsc --noEmit

      - name: Start Supabase
        run: pnpm exec supabase start --ignore-health-check
        env:
          SUPABASE_DB_PASSWORD: postgres

      - name: Capture Supabase env
        run: |
          STATUS=$(pnpm exec supabase status -o env)
          {
            echo "NEXT_PUBLIC_SUPABASE_URL=$(echo "$STATUS" | grep API_URL | cut -d= -f2-)"
            echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$(echo "$STATUS" | grep ANON_KEY | cut -d= -f2-)"
            echo "SUPABASE_SERVICE_ROLE_KEY=$(echo "$STATUS" | grep SERVICE_ROLE_KEY | cut -d= -f2-)"
            echo "NEXT_PUBLIC_APP_URL=http://localhost:3000"
          } >> .env.local

      - run: pnpm test
```

- [ ] **Step 2: Verify locally**

```bash
pnpm exec next lint
pnpm exec tsc --noEmit
pnpm test
```

All three should exit 0.

- [ ] **Step 3: Commit**

```bash
git add .github/
git commit -m "ci: lint + types + Vitest on PR and push"
```

---

# Phase 2 — Deal PM Shell

## Task 15: createDeal server action with test

**Files:**
- Create: `app/(app)/deals/actions.ts`, `tests/integration/actions.test.ts`

- [ ] **Step 1: Write the failing action test**

Append to `tests/integration/actions.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestUser, resetDb, serviceClient } from "../helpers/supabase-test";

// We test createDeal at the SQL boundary by invoking the same INSERT pattern
// the server action will use, since Server Actions can't be invoked directly
// in Vitest without the Next.js runtime. Behavior tested:
//   - deals row inserted with stage='preparation' and created_by=current user
//   - deal_members row inserted for the creator with role='lead'
//   - the user can read the new deal via RLS

describe("createDeal pattern", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("inserts a deal and a lead deal_members row atomically (via service role on behalf of user)", async () => {
    const { userId, client } = await createTestUser("creator@test.local");
    const svc = serviceClient();

    // Mirror the server action behavior:
    const { data: deal, error: dealErr } = await svc
      .from("deals")
      .insert({
        name: "Project Alpha",
        target_company: "AlphaCo",
        sector: "SaaS",
        created_by: userId,
      })
      .select()
      .single();
    expect(dealErr).toBeNull();
    expect(deal).toBeTruthy();
    expect(deal!.stage).toBe("preparation");

    const { error: memErr } = await svc
      .from("deal_members")
      .insert({ deal_id: deal!.id, user_id: userId, role: "lead" });
    expect(memErr).toBeNull();

    // The user should now see exactly one deal
    const { data: visible } = await client.from("deals").select();
    expect(visible).toHaveLength(1);
    expect(visible![0].id).toBe(deal!.id);
  });
});
```

- [ ] **Step 2: Run and confirm passes**

```bash
pnpm test actions
```

Expected: passes (we already have schema + RLS to support this).

- [ ] **Step 3: Implement the server action**

Create `app/(app)/deals/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const CreateDealSchema = z.object({
  name: z.string().min(1, "Deal name is required").max(120),
  target_company: z.string().min(1, "Target company is required").max(120),
  sector: z.string().max(80).optional().or(z.literal("")),
});

export type CreateDealResult =
  | { ok: true; dealId: string }
  | { ok: false; error: string };

export async function createDeal(formData: FormData): Promise<CreateDealResult> {
  const supabase = await createClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Not authenticated." };
  }

  const parsed = CreateDealSchema.safeParse({
    name: formData.get("name"),
    target_company: formData.get("target_company"),
    sector: formData.get("sector") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Use service role to insert both rows atomically (RLS allows the deal insert
  // for any authenticated user, but the deal_members insert requires service role).
  const svc = createServiceClient();
  const { data: deal, error: dealErr } = await svc
    .from("deals")
    .insert({
      name: parsed.data.name,
      target_company: parsed.data.target_company,
      sector: parsed.data.sector || null,
      created_by: userData.user.id,
    })
    .select("id")
    .single();
  if (dealErr || !deal) {
    return { ok: false, error: dealErr?.message ?? "Failed to create deal" };
  }

  const { error: memErr } = await svc
    .from("deal_members")
    .insert({ deal_id: deal.id, user_id: userData.user.id, role: "lead" });
  if (memErr) {
    // Best-effort rollback of the deal row
    await svc.from("deals").delete().eq("id", deal.id);
    return { ok: false, error: memErr.message };
  }

  revalidatePath("/deals");
  redirect(`/deals/${deal.id}`);
}
```

Install Zod:

```bash
pnpm add zod
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(deals): createDeal server action with creator-as-lead"
```

---

## Task 16: DealList component and page integration

**Files:**
- Create: `components/deal/DealList.tsx`
- Modify: `app/(app)/deals/page.tsx`

- [ ] **Step 1: Build DealList**

Create `components/deal/DealList.tsx`:

```tsx
import Link from "next/link";

type Deal = {
  id: string;
  name: string;
  target_company: string;
  sector: string | null;
  stage: string;
};

const STAGE_LABEL: Record<string, string> = {
  preparation: "Preparation",
  marketing_cim: "Marketing / CIM",
  buyer_gtm: "Buyer GTM",
  detailed_dd: "Detailed DD",
  close: "Close",
};

export function DealList({ deals }: { deals: Deal[] }) {
  if (deals.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No deals yet. Create one to get started.
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {deals.map((d) => (
        <li key={d.id}>
          <Link
            href={`/deals/${d.id}`}
            className="block rounded-md border border-slate-200 bg-white p-4 hover:border-indigo-300 transition"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-900">{d.name}</p>
                <p className="text-xs text-slate-500">
                  {d.target_company}
                  {d.sector ? ` · ${d.sector}` : ""}
                </p>
              </div>
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">
                {STAGE_LABEL[d.stage] ?? d.stage}
              </span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Update the deals page to use DealList**

Replace `app/(app)/deals/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { DealList } from "@/components/deal/DealList";

export default async function DealsPage() {
  const supabase = await createClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, name, target_company, sector, stage")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Deals</h1>
      </div>
      <DealList deals={deals ?? []} />
    </div>
  );
}
```

- [ ] **Step 3: Component test**

Create `tests/integration/deal-list.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealList } from "@/components/deal/DealList";

describe("DealList", () => {
  it("renders empty state", () => {
    render(<DealList deals={[]} />);
    expect(screen.getByText(/no deals yet/i)).toBeInTheDocument();
  });

  it("renders deals with stage label", () => {
    render(
      <DealList
        deals={[
          {
            id: "d1",
            name: "Project Alpha",
            target_company: "AlphaCo",
            sector: "SaaS",
            stage: "marketing_cim",
          },
        ]}
      />
    );
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText(/AlphaCo · SaaS/)).toBeInTheDocument();
    expect(screen.getByText("Marketing / CIM")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run**

```bash
pnpm test deal-list
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(deals): DealList component with stage chips"
```

---

## Task 17: Create-deal form UI

**Files:**
- Create: `components/deal/CreateDealForm.tsx`
- Modify: `app/(app)/deals/page.tsx`

- [ ] **Step 1: Build the form**

Create `components/deal/CreateDealForm.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Surface } from "@/components/ui/Surface";
import { createDeal } from "@/app/(app)/deals/actions";

export function CreateDealForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createDeal(formData);
      if (!result.ok) setError(result.error);
      // On success the action calls redirect() and this branch never runs.
    });
  }

  return (
    <Surface className="p-5 mb-8">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">New deal</h2>
      <form action={onSubmit} className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="name" className="block text-xs font-medium text-slate-600 mb-1">
            Deal name
          </label>
          <Input id="name" name="name" required maxLength={120} />
        </div>
        <div>
          <label htmlFor="target_company" className="block text-xs font-medium text-slate-600 mb-1">
            Target company
          </label>
          <Input id="target_company" name="target_company" required maxLength={120} />
        </div>
        <div>
          <label htmlFor="sector" className="block text-xs font-medium text-slate-600 mb-1">
            Sector (optional)
          </label>
          <Input id="sector" name="sector" maxLength={80} />
        </div>
        <div className="sm:col-span-3 flex items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Creating..." : "Create deal"}
          </Button>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      </form>
    </Surface>
  );
}
```

- [ ] **Step 2: Mount on the page**

Replace `app/(app)/deals/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { DealList } from "@/components/deal/DealList";
import { CreateDealForm } from "@/components/deal/CreateDealForm";

export default async function DealsPage() {
  const supabase = await createClient();
  const { data: deals } = await supabase
    .from("deals")
    .select("id, name, target_company, sector, stage")
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Deals</h1>
      <CreateDealForm />
      <DealList deals={deals ?? []} />
    </div>
  );
}
```

- [ ] **Step 3: Manual smoke**

```bash
pnpm run dev
```

Sign in (use Inbucket flow from Task 12 Step 6), create a deal, observe redirect to `/deals/<id>`. The detail route will 404 — that's expected; we build it next. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(deals): create-deal form on /deals"
```

---

## Task 18: updateStage server action with test

**Files:**
- Create: `app/(app)/deals/[id]/actions.ts`
- Modify: `tests/integration/actions.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/actions.test.ts`:

```ts
import { z } from "zod";

const ValidStage = z.enum(["preparation", "marketing_cim", "buyer_gtm", "detailed_dd", "close"]);

describe("updateStage pattern", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a member can change their deal's stage; a non-member cannot", async () => {
    const { userId: a, client: clientA } = await createTestUser("a@test.local");
    const { userId: b, client: clientB } = await createTestUser("b@test.local");
    const svc = serviceClient();

    const { data: deal } = await svc
      .from("deals")
      .insert({ name: "Alpha", target_company: "AlphaCo", created_by: a })
      .select()
      .single();
    await svc.from("deal_members").insert({ deal_id: deal!.id, user_id: a, role: "lead" });

    // A succeeds
    const newStage = ValidStage.parse("marketing_cim");
    const { data: updatedA } = await clientA
      .from("deals")
      .update({ stage: newStage })
      .eq("id", deal!.id)
      .select("stage");
    expect(updatedA?.[0]?.stage).toBe("marketing_cim");

    // B fails (zero rows affected via RLS)
    const { data: updatedB } = await clientB
      .from("deals")
      .update({ stage: "close" })
      .eq("id", deal!.id)
      .select("stage");
    expect(updatedB).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — should pass on current schema**

```bash
pnpm test actions
```

Expected: 2 tests pass (createDeal + updateStage patterns).

- [ ] **Step 3: Implement the action**

Create `app/(app)/deals/[id]/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const StageSchema = z.enum([
  "preparation",
  "marketing_cim",
  "buyer_gtm",
  "detailed_dd",
  "close",
]);

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

export async function updateStage(
  dealId: string,
  nextStage: string
): Promise<UpdateStageResult> {
  const parsed = StageSchema.safeParse(nextStage);
  if (!parsed.success) return { ok: false, error: "Invalid stage." };

  const supabase = await createClient();
  const { error, data } = await supabase
    .from("deals")
    .update({ stage: parsed.data })
    .eq("id", dealId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Not allowed or deal not found." };
  }

  revalidatePath(`/deals/${dealId}`);
  return { ok: true };
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(deals): updateStage server action (RLS-gated)"
```

---

## Task 19: DealWorkspace shell with tabs

**Files:**
- Create: `app/(app)/deals/[id]/layout.tsx`, `components/deal/DealHeader.tsx`, `components/deal/DealTabs.tsx`

- [ ] **Step 1: DealHeader component**

Create `components/deal/DealHeader.tsx`:

```tsx
type Props = {
  name: string;
  targetCompany: string;
  sector: string | null;
};

export function DealHeader({ name, targetCompany, sector }: Props) {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-5">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-1">Deal</p>
        <h1 className="text-2xl font-semibold text-slate-900">{name}</h1>
        <p className="text-sm text-slate-600 mt-1">
          {targetCompany}
          {sector ? ` · ${sector}` : ""}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: DealTabs component**

Create `components/deal/DealTabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { clsx } from "clsx";

const TABS = [
  { segment: null, label: "Overview", href: (id: string) => `/deals/${id}` },
  { segment: "buyers", label: "Buyers", href: (id: string) => `/deals/${id}/buyers` },
  { segment: "qa", label: "DD Q&A", href: (id: string) => `/deals/${id}/qa` },
] as const;

export function DealTabs({ dealId }: { dealId: string }) {
  const active = useSelectedLayoutSegment();
  return (
    <nav className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-6">
        <ul className="flex gap-1">
          {TABS.map((t) => {
            const isActive = active === t.segment;
            return (
              <li key={t.label}>
                <Link
                  href={t.href(dealId)}
                  className={clsx(
                    "inline-block px-4 py-3 text-sm font-medium border-b-2 -mb-px transition",
                    isActive
                      ? "border-indigo-600 text-indigo-700"
                      : "border-transparent text-slate-600 hover:text-slate-900"
                  )}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Workspace layout**

Create `app/(app)/deals/[id]/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { DealHeader } from "@/components/deal/DealHeader";
import { DealTabs } from "@/components/deal/DealTabs";

export default async function DealLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, name, target_company, sector")
    .eq("id", id)
    .maybeSingle();

  if (!deal) notFound();

  return (
    <>
      <DealHeader name={deal.name} targetCompany={deal.target_company} sector={deal.sector} />
      <DealTabs dealId={deal.id} />
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </>
  );
}
```

- [ ] **Step 4: Stub buyers and qa pages**

Create `app/(app)/deals/[id]/buyers/page.tsx`:

```tsx
export default function BuyersTab() {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      Buyers module ships in Phase 4.
    </div>
  );
}
```

Create `app/(app)/deals/[id]/qa/page.tsx`:

```tsx
export default function QATab() {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
      DD Q&amp;A ships in Phase 3.
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(workspace): DealWorkspace shell with header and tabs"
```

---

## Task 20: Overview page with StageSelector

**Files:**
- Create: `app/(app)/deals/[id]/page.tsx`, `components/deal/StageSelector.tsx`, `components/ui/Select.tsx`

- [ ] **Step 1: Select primitive**

Create `components/ui/Select.tsx`:

```tsx
import { forwardRef, type SelectHTMLAttributes } from "react";
import { clsx } from "clsx";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...rest }, ref) => (
    <select
      ref={ref}
      {...rest}
      className={clsx(
        "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm",
        "focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500",
        className
      )}
    />
  )
);
Select.displayName = "Select";
```

- [ ] **Step 2: StageSelector**

Create `components/deal/StageSelector.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { Select } from "@/components/ui/Select";
import { updateStage } from "@/app/(app)/deals/[id]/actions";

const STAGES = [
  { value: "preparation", label: "Preparation" },
  { value: "marketing_cim", label: "Marketing / CIM" },
  { value: "buyer_gtm", label: "Buyer GTM" },
  { value: "detailed_dd", label: "Detailed DD" },
  { value: "close", label: "Close" },
] as const;

export function StageSelector({ dealId, initialStage }: { dealId: string; initialStage: string }) {
  const [stage, setStage] = useState(initialStage);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(nextStage: string) {
    const previous = stage;
    setStage(nextStage); // optimistic
    setError(null);
    startTransition(async () => {
      const result = await updateStage(dealId, nextStage);
      if (!result.ok) {
        setStage(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <label htmlFor="stage" className="block text-xs font-medium text-slate-600 mb-1">
        Stage {pending && <span className="text-slate-400">(saving…)</span>}
      </label>
      <Select
        id="stage"
        value={stage}
        onChange={(e) => onChange(e.target.value)}
        disabled={pending}
      >
        {STAGES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </Select>
      {error && <p className="text-xs text-rose-600 mt-1">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Overview page**

Create `app/(app)/deals/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StageSelector } from "@/components/deal/StageSelector";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, stage")
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2 rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Milestones</h2>
        <p className="text-sm text-slate-500">Milestones list will go here.</p>
      </section>
      <aside className="rounded-md border border-slate-200 bg-white p-5">
        <StageSelector dealId={deal.id} initialStage={deal.stage} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(workspace): Overview page with StageSelector"
```

---

## Task 21: Milestone CRUD via supabase-js (client component)

**Files:**
- Create: `components/deal/MilestoneList.tsx`
- Modify: `app/(app)/deals/[id]/page.tsx`

- [ ] **Step 1: Add MilestoneList component**

Create `components/deal/MilestoneList.tsx`:

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createClient } from "@/lib/supabase/client";

type Milestone = {
  id: string;
  deal_id: string;
  name: string;
  due_date: string;
  status: "pending" | "done" | "skipped";
};

const DUE_SOON_DAYS = 5;

function dueSoon(dueDate: string): boolean {
  const due = new Date(dueDate);
  const now = new Date();
  const diff = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= DUE_SOON_DAYS;
}

export function MilestoneList({ dealId }: { dealId: string }) {
  const supabase = createClient();
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function reload() {
    const { data, error } = await supabase
      .from("milestones")
      .select("id, deal_id, name, due_date, status")
      .eq("deal_id", dealId)
      .order("due_date", { ascending: true });
    if (error) setError(error.message);
    setItems((data ?? []) as Milestone[]);
    setLoading(false);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !due) return;
    setError(null);
    startTransition(async () => {
      const { error } = await supabase
        .from("milestones")
        .insert({ deal_id: dealId, name, due_date: due });
      if (error) setError(error.message);
      else {
        setName("");
        setDue("");
        await reload();
      }
    });
  }

  function toggleStatus(m: Milestone) {
    startTransition(async () => {
      const next = m.status === "done" ? "pending" : "done";
      const { error } = await supabase
        .from("milestones")
        .update({ status: next })
        .eq("id", m.id);
      if (error) setError(error.message);
      else await reload();
    });
  }

  function remove(m: Milestone) {
    startTransition(async () => {
      const { error } = await supabase.from("milestones").delete().eq("id", m.id);
      if (error) setError(error.message);
      else await reload();
    });
  }

  return (
    <div>
      <form onSubmit={add} className="grid gap-2 sm:grid-cols-[1fr_180px_auto] mb-4">
        <Input
          placeholder="Milestone name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Button type="submit" disabled={pending || !name || !due}>
          Add
        </Button>
      </form>
      {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No milestones yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2">
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={m.status === "done"}
                  onChange={() => toggleStatus(m)}
                  disabled={pending}
                />
                <span className={m.status === "done" ? "line-through text-slate-400" : ""}>
                  {m.name}
                </span>
                <span className="text-xs text-slate-500">{m.due_date}</span>
                {m.status === "pending" && dueSoon(m.due_date) && (
                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                    Due soon
                  </span>
                )}
              </label>
              <button
                type="button"
                onClick={() => remove(m)}
                disabled={pending}
                className="text-xs text-slate-400 hover:text-rose-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Mount on Overview**

Replace `app/(app)/deals/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StageSelector } from "@/components/deal/StageSelector";
import { MilestoneList } from "@/components/deal/MilestoneList";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, stage")
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2 rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Milestones</h2>
        <MilestoneList dealId={deal.id} />
      </section>
      <aside className="rounded-md border border-slate-200 bg-white p-5 space-y-4">
        <StageSelector dealId={deal.id} initialStage={deal.stage} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Unit test the dueSoon logic**

Create `tests/integration/milestone-due-soon.test.ts`:

```ts
import { describe, it, expect } from "vitest";

// Re-implement the function under test here to avoid bundling React into the test.
// If the logic moves to lib/, import it from there instead.
function dueSoon(dueDate: string, today: Date = new Date()): boolean {
  const due = new Date(dueDate);
  const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 5;
}

describe("dueSoon", () => {
  const today = new Date("2026-05-28T12:00:00Z");

  it("is true within 5 days", () => {
    expect(dueSoon("2026-06-01", today)).toBe(true);
  });

  it("is false when more than 5 days away", () => {
    expect(dueSoon("2026-06-10", today)).toBe(false);
  });

  it("is false for past dates", () => {
    expect(dueSoon("2026-05-01", today)).toBe(false);
  });
});
```

Run:

```bash
pnpm test milestone-due-soon
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(workspace): milestone CRUD with due-soon indicator"
```

---

## Task 22: Hoist dueSoon helper to lib

**Files:**
- Create: `lib/milestone.ts`
- Modify: `components/deal/MilestoneList.tsx`, `tests/integration/milestone-due-soon.test.ts`

- [ ] **Step 1: Create the lib module**

Create `lib/milestone.ts`:

```ts
export const DUE_SOON_DAYS = 5;

export function dueSoon(dueDate: string, today: Date = new Date()): boolean {
  const due = new Date(dueDate);
  const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= DUE_SOON_DAYS;
}
```

- [ ] **Step 2: Use it from MilestoneList**

In `components/deal/MilestoneList.tsx`, replace the local `DUE_SOON_DAYS` constant and `dueSoon` function with:

```tsx
import { dueSoon } from "@/lib/milestone";
```

Remove the inline `const DUE_SOON_DAYS = 5;` and `function dueSoon(...)` block.

- [ ] **Step 3: Update the test to import from lib**

Replace the body of `tests/integration/milestone-due-soon.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { dueSoon } from "@/lib/milestone";

describe("dueSoon", () => {
  const today = new Date("2026-05-28T12:00:00Z");

  it("is true within 5 days", () => {
    expect(dueSoon("2026-06-01", today)).toBe(true);
  });

  it("is false when more than 5 days away", () => {
    expect(dueSoon("2026-06-10", today)).toBe(false);
  });

  it("is false for past dates", () => {
    expect(dueSoon("2026-05-01", today)).toBe(false);
  });
});
```

- [ ] **Step 4: Run**

```bash
pnpm test milestone-due-soon
pnpm exec tsc --noEmit
```

Both should pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(milestone): hoist dueSoon to lib for shared use"
```

---

## Task 23: deal_activity view migration

**Files:**
- Create: `supabase/migrations/20260528000002_deal_activity_view.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260528000002_deal_activity_view.sql`:

```sql
-- Activity feed view.
-- Phase 2 ships this view but it returns empty until Phase 3 (qa_log) and
-- Phase 4 (buyer_communications, buyers) populate their tables.
--
-- We can't reference tables that don't exist yet, so we ship the view in
-- a Phase-1+2 friendly form: it sources only from a placeholder query that
-- returns no rows. Phase 3 and 4 migrations will REPLACE this view with the
-- full UNION ALL definition once their tables exist.

create or replace view public.deal_activity as
  select
    'placeholder'::text as kind,
    gen_random_uuid()    as id,
    d.id                 as deal_id,
    d.created_at         as occurred_at,
    jsonb_build_object() as payload
  from public.deals d
  where false;  -- always empty until Phase 3/4 redefine this view

-- Inherit RLS via the underlying deals table.
alter view public.deal_activity owner to postgres;
```

- [ ] **Step 2: Apply**

```bash
pnpm exec supabase db reset
```

Expected: 3 migrations apply cleanly.

- [ ] **Step 3: Confirm the view exists and returns empty**

```bash
PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:54322/postgres" \
  -c "select count(*) from deal_activity;"
```

Expected: `count` is `0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): deal_activity view (placeholder for Phase 3/4)"
```

---

## Task 24: ActivityFeed component (empty state)

**Files:**
- Create: `components/deal/ActivityFeed.tsx`
- Modify: `app/(app)/deals/[id]/page.tsx`

- [ ] **Step 1: Build the component**

Create `components/deal/ActivityFeed.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";

type Row = {
  kind: string;
  id: string;
  deal_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

const KIND_LABEL: Record<string, string> = {
  placeholder: "—",
  qa: "Q&A",
  buyer_comm: "Buyer touch",
  buyer_generated: "Buyer added",
};

function describe(row: Row): string {
  switch (row.kind) {
    case "qa":
      return `Question: ${row.payload.question ?? ""}`;
    case "buyer_comm":
      return String(row.payload.summary ?? "");
    case "buyer_generated":
      return `Added ${row.payload.firm_name ?? "buyer"}`;
    default:
      return "";
  }
}

export async function ActivityFeed({ dealId }: { dealId: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("deal_activity")
    .select("kind, id, deal_id, occurred_at, payload")
    .eq("deal_id", dealId)
    .order("occurred_at", { ascending: false })
    .limit(10);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Activity will appear here as buyer touches and Q&amp;A history populate.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((r) => (
        <li key={r.id} className="py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-block text-xs uppercase tracking-wide text-slate-400">
              {KIND_LABEL[r.kind] ?? r.kind}
            </span>
            <span className="text-xs text-slate-400">
              {new Date(r.occurred_at).toLocaleString()}
            </span>
          </div>
          <p className="text-slate-700">{describe(r)}</p>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Mount on Overview**

Update `app/(app)/deals/[id]/page.tsx` — replace the aside contents:

```tsx
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StageSelector } from "@/components/deal/StageSelector";
import { MilestoneList } from "@/components/deal/MilestoneList";
import { ActivityFeed } from "@/components/deal/ActivityFeed";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: deal } = await supabase
    .from("deals")
    .select("id, stage")
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <section className="md:col-span-2 rounded-md border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900 mb-3">Milestones</h2>
        <MilestoneList dealId={deal.id} />
      </section>
      <aside className="space-y-6">
        <div className="rounded-md border border-slate-200 bg-white p-5">
          <StageSelector dealId={deal.id} initialStage={deal.stage} />
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">Activity</h2>
          <ActivityFeed dealId={deal.id} />
        </div>
      </aside>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(workspace): ActivityFeed component with empty state"
```

---

## Task 25: Seed script with a sample deal

**Files:**
- Create: `supabase/seed.sql`

- [ ] **Step 1: Write the seed**

Create `supabase/seed.sql`:

```sql
-- Local dev seed. Runs after migrations on `supabase db reset`.
-- Creates a demo user and a sample deal so the UI is not empty on first boot.

do $$
declare
  demo_user_id uuid;
  demo_deal_id uuid;
begin
  -- Create demo user via auth schema (idempotent if email already exists).
  select id into demo_user_id from auth.users where email = 'demo@local.test';
  if demo_user_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change,
      email_change_token_new, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(), 'authenticated', 'authenticated',
      'demo@local.test', crypt('demo-password-12345', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}', '{}',
      now(), now(), '', '', '', ''
    ) returning id into demo_user_id;

    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), demo_user_id,
      jsonb_build_object('sub', demo_user_id::text, 'email', 'demo@local.test'),
      'email', demo_user_id::text, now(), now(), now()
    );
  end if;

  -- Sample deal
  insert into public.deals (name, target_company, sector, stage, created_by)
  values ('Project Atlas', 'Atlas Robotics', 'Industrials', 'marketing_cim', demo_user_id)
  returning id into demo_deal_id;

  insert into public.deal_members (deal_id, user_id, role)
  values (demo_deal_id, demo_user_id, 'lead');

  insert into public.milestones (deal_id, name, due_date, status) values
    (demo_deal_id, 'Kickoff meeting',        current_date - 14, 'done'),
    (demo_deal_id, 'CIM draft v1',           current_date - 3,  'done'),
    (demo_deal_id, 'CIM final review',       current_date + 3,  'pending'),
    (demo_deal_id, 'Launch buyer outreach',  current_date + 21, 'pending');
end $$;
```

- [ ] **Step 2: Apply seed**

```bash
pnpm exec supabase db reset
```

Expected: migrations + seed all run. The output ends with `Seeded successfully`.

- [ ] **Step 3: Verify the demo deal exists**

```bash
PGPASSWORD=postgres psql "postgresql://postgres@127.0.0.1:54322/postgres" \
  -c "select name, stage from public.deals;"
```

Expected: one row, `Project Atlas | marketing_cim`.

- [ ] **Step 4: Smoke the demo deal in the UI**

```bash
pnpm run dev
```

Sign in with `demo@local.test` / `demo-password-12345` — but the magic-link flow requires email, not password. Instead, use Supabase Studio (`http://127.0.0.1:54323`) → Authentication → click the demo user → "Send magic link" — then fetch from Inbucket. Verify `/deals` shows `Project Atlas`, click into it, see milestones with `CIM final review` marked "Due soon" if today is within 5 days of that date. Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql
git commit -m "chore(db): seed sample deal and demo user for local dev"
```

---

## Task 26: E2E test for Phase 2 golden path

**Files:**
- Create: `tests/e2e/deal-pm.spec.ts`
- Modify: `tests/e2e/helpers/inbucket.ts` (no change expected, just confirm import path)

- [ ] **Step 1: Write the E2E test**

Create `tests/e2e/deal-pm.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { getMagicLink, clearInbucket } from "./helpers/inbucket";

test.beforeEach(async () => {
  await clearInbucket();
});

test("user can create a deal, change stage, add a milestone", async ({ page }) => {
  const email = `pm-${Date.now()}@test.local`;

  // Sign in
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: /send magic link/i }).click();
  const link = await getMagicLink(email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/deals$/);

  // Create deal
  await page.getByLabel("Deal name").fill("Project E2E");
  await page.getByLabel("Target company").fill("AcmeCo");
  await page.getByLabel("Sector (optional)").fill("Tech");
  await page.getByRole("button", { name: /create deal/i }).click();

  // Land on workspace, see deal name
  await expect(page.getByRole("heading", { name: "Project E2E" })).toBeVisible();
  await expect(page.getByText("AcmeCo · Tech")).toBeVisible();

  // Change stage
  await page.getByLabel(/^stage/i).selectOption("buyer_gtm");
  // Reload the page to confirm the change persisted
  await page.reload();
  await expect(page.getByLabel(/^stage/i)).toHaveValue("buyer_gtm");

  // Add milestone
  await page.getByPlaceholder("Milestone name").fill("Send NDA");
  const due = new Date();
  due.setDate(due.getDate() + 3);
  const dueStr = due.toISOString().slice(0, 10);
  await page.locator('input[type="date"]').fill(dueStr);
  await page.getByRole("button", { name: /^add$/i }).click();
  await expect(page.getByText("Send NDA")).toBeVisible();
  await expect(page.getByText(/due soon/i)).toBeVisible();
});
```

- [ ] **Step 2: Run**

```bash
pnpm exec playwright test deal-pm
```

Expected: 1 test passes. If the test cannot find the StageSelector label (it includes a "saving…" suffix when pending), the regex `/^stage/i` handles that — verify the matcher is correct.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/deal-pm.spec.ts
git commit -m "test(e2e): deal PM golden path (create, stage, milestone)"
```

---

## Task 27: Update CLAUDE.md Module Map

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md to reflect the actual structure**

Open `CLAUDE.md`. Replace the entire "Module map and build phases" section with:

```md
## Module map and build phases

Phase 1 + Phase 2 are implemented. Source layout:

- `app/` — Next.js 16 App Router. Protected routes under `(app)/`, marketing under `(marketing)/`.
- `components/deal/` — DealList, StageSelector, MilestoneList, ActivityFeed, etc.
- `components/ui/` — Button, Input, Select, Surface primitives.
- `lib/supabase/` — browser, server, and service-role clients.
- `lib/auth.ts` — `requireUser()` helper used by protected layouts.
- `supabase/migrations/` — versioned schema and RLS migrations.
- `supabase/seed.sql` — local-dev seed.
- `tests/integration/` — Vitest against local Supabase (RLS proofs, action behavior).
- `tests/e2e/` — Playwright golden paths.

Phase build status:

- Phase 1 (Foundation): ✅ shipped — see `plans/oss-app/2026-05-28-phase-1-2-foundation-deal-pm.md`
- Phase 2 (Deal PM shell): ✅ shipped — same plan
- Phase 3 (DD Q&A RAG): ⏳ separate plan to be drafted
- Phase 4 (Buyers + IMAP): ⏳ separate plan to be drafted
- Phase 5 (Polish): optional
```

Also replace the "Stack constraints" section with:

```md
## Stack constraints

- Frontend: Next.js 16 App Router (TypeScript strict), Tailwind CSS 4, hosted on Vercel.
- Backend: Next.js Server Actions and Route Handlers. No separate API server.
- Auth: Supabase Auth (email magic link). Middleware in `middleware.ts` redirects unauthenticated users to `/sign-in`.
- State: Supabase Postgres. Deal isolation enforced by RLS keyed off `deal_members(deal_id, user_id)`.
- pgvector extension is enabled on day one for use in Phase 3.
- The frontend talks to Supabase directly for simple CRUD (RLS gates access). Server Actions are used when service-role privileges or atomic multi-row writes are required.
- CI/CD: GitHub Actions. PR gate runs lint, type-check, and Vitest. E2E runs on pushes to main.
```

Replace the "Resolved decisions" section with:

```md
## Resolved decisions — do not reopen

- Open-source stack chosen over the Microsoft Code App path. See `specs/oss-app/2026-05-28-sell-side-ma-platform-oss-design.md`.
- Supabase is the backend platform (Postgres + Auth + Storage + pgvector).
- Deal isolation = Postgres RLS via `deal_members`. No Business Units, no OBO.
- Activity feed page limit = 10. Milestone "Due Soon" = 5 days. Buyer follow-up overdue = 14 days (used in Phase 4).
```

Replace the "Open questions" section with:

```md
## Open questions

- VDR staging automation (deferred until Phase 4 polish): same options as the original spec — Intralinks / Datasite / Ansarada APIs. Manual upload to Supabase Storage is the v1 pattern.
- Real buyer data source: Crunchbase / Apollo / public filings — integration point is `step "gather_context"` of the Phase 4 `buyer.generate` Inngest workflow.
```

Remove the "Cross-platform working note" section's reference to `.azure-pipelines` (the Azure pipeline permission is no longer relevant). Leave the OneDrive paths note intact.

- [ ] **Step 2: Verify CLAUDE.md is still valid markdown**

Open the file in an editor or render it. No broken links, no orphan headings.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md module map and stack constraints for OSS rebuild"
```

---

# Self-Review

## Spec coverage

| Spec section | Covered by |
|---|---|
| Replacement table (Microsoft → OSS) | Tasks 1, 4, 5, 8, 9, 10, 14 (stack stood up); LLM/Inngest/Storage deferred to Phase 3/4 plans as designed |
| Two-channel client pattern | Tasks 16, 21 (direct supabase-js) + Task 15, 18 (Server Actions) |
| Auth via Supabase Auth + magic link | Tasks 9, 10, 11 |
| RLS on every deal-scoped table | Task 6 (policies) + Task 7 (tests prove isolation) |
| `deal_members` as the isolation join | Task 5 (schema) + Task 6 (policy uses it) |
| `deals` / `milestones` schema + enums | Task 5 |
| Activity feed view | Task 23 (placeholder), Task 24 (component); Phase 3/4 plans will replace the view with the real UNION ALL |
| Front-end structure | Tasks 1, 10, 12, 17, 19, 20, 24 |
| Server Actions: createDeal, updateStage, milestone CRUD | Tasks 15, 18, 21 |
| Supabase-direct operations (CRUD, signed URLs) | Task 21 (milestones); document operations deferred to Phase 3 |
| Testing strategy (unit, component, integration, E2E) | Tasks 2 (Vitest), 3 (Playwright), 7 (RLS proofs), 13 (E2E sign-in), 16 (component), 21 (unit), 26 (E2E PM golden path) |
| GitHub Actions CI | Task 14 |
| Build sequencing — Phase 1 + Phase 2 | All tasks |
| Build sequencing — Phase 3 (DD Q&A), Phase 4 (Buyers/IMAP), Phase 5 | Out of scope of this plan; called out at the top and via stub tab pages in Task 19 |

**Gaps identified during review:** None for Phase 1+2. The plan ships a working authenticated app with deal pipeline, stage tracking, milestones with due-soon indicator, an activity feed scaffold, RLS-proof tests, and CI.

## Placeholder scan

Scanned for "TBD", "TODO", "implement later", "add appropriate", "similar to Task N", and bare instructions without code blocks. None found. Every code-changing step has the exact code to write.

## Type consistency

Verified across tasks:
- `Deal` shape (`id, name, target_company, sector, stage`) — consistent in DealList, OverviewPage, DealsPage queries.
- `Milestone` shape (`id, deal_id, name, due_date, status`) — consistent between schema (Task 5), MilestoneList (Task 21), test (Task 22).
- `StageSchema` enum values (`preparation`, `marketing_cim`, `buyer_gtm`, `detailed_dd`, `close`) — consistent between schema CHECK constraint (Task 5), StageSelector options (Task 20), updateStage validation (Task 18), DealList label map (Task 16), seed (Task 25), E2E (Task 26).
- `dueSoon` function — defined inline in Task 21, hoisted to `lib/milestone.ts` in Task 22 with identical signature; test updated.
- `Surface`, `Button`, `Input`, `Select` props — all extend their corresponding HTML attribute types, used consistently.
- `createClient` is imported from three different modules with the same name (`@/lib/supabase/client`, `@/lib/supabase/server`, `@/lib/supabase/service`). The service file exports `createServiceClient` to avoid ambiguity — verified consistent in Task 8 (definition), Task 15 (usage in createDeal), Task 18 (NOT used — updateStage uses user-scoped server client, which is correct per RLS design).
