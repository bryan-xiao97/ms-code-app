# Solomon Partners Sell-Side M&A Platform

This repo currently holds specs and prototypes for a sell-side M&A platform being built for Solomon Partners. Implementation code does not exist yet; when it lands, it will follow the planned `frontend/`, `backend/`, `infra/`, `.azure-pipelines/` layout. This CLAUDE.md must be updated alongside any code scaffold.

## Read this first

Before proposing anything domain-shaped, read `process.md`. It is the banker-workflow vocabulary primer covering the 5-phase sell-side M&A process (Preparation → Marketing/CIM → Buyer GTM → Detailed Diligence → Close) and the key terms: CIM, IOI, LOI, VDR, NDA, and others. Proposals that misuse these terms or misread the process will be rejected.

## Spec hierarchy

- `specs/code-app/2026-05-20-sell-side-ma-platform-code-app-design.md` — authoritative architecture spec. This is the source of truth for all technical decisions.
- `specs/code-app/deal-pm-phase2-design.md` — Phase 2 slice (Deal PM shell). Derived from the main spec; the main spec wins on any conflict.
- `specs/canvas-app/2026-05-19-sell-side-ma-platform-design.md` — trade-off artifact. The Code App path was chosen over Canvas App. Read this for the reasoning behind that decision, not for what to build.
- Every `.md` spec has a rendered `.html` twin. Never edit the HTML files; the `.md` is always the source of truth.

## Module map and build phases

No source code modules exist yet. The planned build sequence from the authoritative spec is:

- Phase 1 — Infrastructure and Auth: Azure Static Web Apps, Azure Functions, Key Vault, managed identity, MSAL app registration, Dataverse schema, Azure DevOps pipeline gates.
- Phase 2 — Deal PM shell (current focus): DealList, DealWorkspace shell, StageSelector, Overview tab with stage indicator and milestone CRUD, backend `/api/deals` and `/api/deals/{id}/milestones` endpoints. Active design doc: `specs/code-app/deal-pm-phase2-design.md`. Active prototype: `prototypes/deal-pm-phase2-ui.html`.
- Phase 3 — Buyers module: buyer table, inline editing, overdue indicators, Power Automate background flows, activity feed for buyer events. Builds on existing ADO Epic 4031.
- Phase 4 — DD Q&A: Azure AI Foundry index over deal SharePoint site, Q&A tab, export. Depends on VDR staging being operationalized.

## Stack constraints

- Frontend: React + TypeScript, Vite or CRA, hosted on Azure Static Web Apps.
- Backend: Azure Functions (Node.js / TypeScript). No Express. No separate server process.
- Auth: MSAL.js on the front end; Azure AD OBO flow on the backend; system-assigned managed identity for Dataverse and Foundry. No API keys for those services.
- State: Dataverse only. No separate operational database.
- The frontend never calls Dataverse directly. All Dataverse access goes through the Functions backend.
- CI/CD: Azure DevOps. PR gate runs lint, type-check, and unit tests on both frontend and backend.

## Resolved decisions — do not reopen

- Code App is the chosen implementation path. Canvas App is not being built.
- Single shared Dataverse environment. Deal-level isolation is enforced via Business Units and OBO-based RLS.
- SharePoint site provisioning is manual at engagement start for v1. Automation is deferred.
- Activity feed page limit = 10 items. Milestone "Due Soon" threshold = 5 days. Buyer follow-up overdue threshold = 14 days.

## Open questions

- VDR staging automation: Intralinks, Datasite, and Ansarada all expose APIs. The vendor choice and API coverage are undecided. Phase 4 is blocked until this is resolved.

## Cross-platform working note

The repo lives in OneDrive and is opened from two machines:

- Mac: `/Users/admin/Library/CloudStorage/OneDrive-Personal/Bryan_Docs/Tech/Personal_projects/ms-code-app`
- Windows: `C:\Users\Bryan.Xiao\OneDrive - Solomon Partners, L.P\Bryan_Docs\Projects_Code\Sellside-MA`

`.claude/settings.local.json` contains a Windows-only PowerShell `Start-Process` permission scoped to opening the prototype HTML from the Windows OneDrive path. Mac sessions should not add or modify that permission, and should not propose adding a Mac equivalent unless asked.

## Current repo state

No source code exists. There is no `package.json`, no `tsconfig.json`, no lint config, and no test suite. The files present are:

- `process.md` — domain vocabulary and banker workflow primer.
- `specs/` — design specs and their rendered HTML exports.
- `prototypes/deal-pm-phase2-ui.html` — the latest Phase 2 UI mockup as of 2026-05-28, subject to iteration.
- `.claude/settings.local.json` — local Claude permissions (Windows-only entry).

When implementation code is scaffolded, update the Module map section of this file to reflect the actual directory structure.
