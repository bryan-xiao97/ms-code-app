# Deal PM (Phase 2) — Code App Design
_Extracted from: Sell-Side M&A Platform — Code App Technical Design Spec (2026-05-20, Bryan Xiao)_

This is the Phase 2 "Deal PM shell" slice of the broader Code App design. It covers everything needed to build the deal-list home screen, the deal workspace shell, the Overview tab (stage indicator, milestone timeline, activity feed), and the supporting backend endpoints. Buyers and DD Q&A modules (Phases 3 and 4) are out of scope here.

## Scope

In scope for Phase 2:

- Deal list and deal workspace shell (React SPA)
- Overview tab: stage indicator, milestone CRUD, activity feed (renders empty until later phases populate data)
- Deals and Milestones tables in Dataverse
- Backend endpoints for deals, milestones, and the activity feed merge
- Auth (MSAL + managed identity + Dataverse Business Unit RLS via OBO)
- Infrastructure and ALM groundwork required to ship the shell

Out of scope for Phase 2: Buyers module, DD Q&A, VDR staging, background PA flows, export.

## Architecture (Phase 2 slice)

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONT-END                                                      │
│  React SPA (TypeScript) — Azure Static Web Apps                 │
│  Auth: MSAL (Azure AD) — token for Functions app                │
└───────────────────────────┬─────────────────────────────────────┘
                            │  HTTPS + Azure AD bearer token
┌───────────────────────────▼─────────────────────────────────────┐
│  API BACKEND                                                    │
│  Azure Functions (Node.js / TypeScript)                         │
│  OBO flow → Dataverse Web API (as authenticated banker)         │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                       Dataverse Web API
                       (Deals, Milestones;
                        QALog + BuyerCommunications + Buyers
                        read-only for activity feed merge)
```

## Authentication & deal access control

- **Front-end:** MSAL.js authenticates the banker against Azure AD and acquires an access token scoped to the Functions app (`api://<functions-app-client-id>`). All API calls include this token as a bearer token.
- **Backend:** The Functions app uses the Azure AD On-Behalf-Of flow to exchange the user token for a Dataverse-scoped token. Dataverse receives the user's identity and enforces Business Unit-based RLS natively — the Functions app does no deal-level filtering itself.
- **Deal isolation:** Each deal maps to one Dataverse Business Unit. Bankers are assigned to the Business Units corresponding to their active deals by a Dataverse admin (manual step at deal onboarding). The deal list returned to the SPA contains only deals the authenticated banker is assigned to.
- **Outbound auth from Functions:** The Functions app's system-assigned managed identity holds the minimum required Dataverse security role for read/write on platform tables. No secrets needed for Dataverse access in Phase 2.

## Front-end structure (Phase 2)

```
src/
  pages/
    DealList.tsx          — home screen: deal pipeline list
    DealWorkspace.tsx     — deal workspace shell (header + tabs; Overview tab active)
  components/
    tabs/
      Overview.tsx        — stage indicator, milestone timeline, activity feed
    shared/
      StageSelector.tsx   — deal stage dropdown (writes to /api/deals/{id})
      MilestoneList.tsx   — milestone CRUD with inline editing
      ActivityFeed.tsx    — merged event feed from /api/deals/{id}/activity
  services/
    api.ts                — typed fetch wrapper (attaches bearer token, handles errors)
  auth/
    msalConfig.ts         — MSAL configuration (client ID, authority, scopes)
```

The Buyers and DDQA tab components are stubbed in the workspace shell but not implemented until Phases 3 and 4.

The front-end holds no business logic beyond display and user interaction. All data operations go through `api.ts` → Azure Functions.

## Backend API endpoints (Phase 2)

All endpoints are HTTP-triggered Azure Functions. The Functions app enforces Azure AD token validation on every request (Easy Auth or manual JWT validation middleware).

| Endpoint | Method | Action |
|---|---|---|
| `/api/deals` | GET | List all deals visible to the user (Dataverse RLS applies) |
| `/api/deals` | POST | Create deal record (name, target, sector, stage = Preparation) |
| `/api/deals/{id}` | PATCH | Update deal stage |
| `/api/deals/{id}/milestones` | GET | List milestones for the deal |
| `/api/deals/{id}/milestones` | POST | Create milestone record |
| `/api/deals/{id}/milestones/{milestoneId}` | PATCH | Update milestone (name, date) |
| `/api/deals/{id}/milestones/{milestoneId}` | DELETE | Delete milestone record |
| `/api/deals/{id}/activity` | GET | Merge BuyerCommunications + QALog + Buyers generation events, sorted by timestamp |

The activity feed endpoint ships in Phase 2 even though the upstream tables it reads (BuyerCommunications, QALog, Buyers) are not populated until Phases 3 and 4. The feed simply returns an empty list until those modules come online.

### Error handling

- Dataverse Web API errors (4xx, 5xx) are caught and returned as structured JSON `{ error: string, code: number }` to the front-end.
- All errors are logged to Application Insights via the Functions app.

## Data model (Phase 2)

| Table | Written By | Read By |
|---|---|---|
| Deals | Functions (`/api/deals`) | All endpoints |
| Milestones | Functions (`/api/deals/{id}/milestones`) | Overview tab via `/api/deals/{id}/milestones` |

Tables that exist in the schema but are only read by Phase 2 (via the activity feed merge, which will return empty rows until later phases): Buyers, BuyerCommunications, QALog.

**Dataverse access pattern:** Functions reach Dataverse via the Web API using the OBO token. Reads use OData queries; writes use standard POST/PATCH. The front-end never calls Dataverse directly.

## Status thresholds

- **Milestone Due Soon:** 5 days before the milestone due date. Fixed platform-wide.

## Build steps for Phase 2

Phase 2 depends on Phase 1 (infrastructure & auth) being complete: Static Web Apps and Functions app provisioned, managed identity granted Dataverse role, MSAL app registration, Dataverse schema for Deals (with Stage field) and Milestones created, Azure DevOps pipeline gates in place.

Phase 2 deliverables:

- **Frontend:** `DealList`, `DealWorkspace` shell, `StageSelector`, Overview tab with milestone CRUD and an empty-state activity feed.
- **Backend:** `/api/deals` (GET, POST, PATCH), `/api/deals/{id}/milestones` (GET, POST, PATCH, DELETE), `/api/deals/{id}/activity` (GET, returning the merge — empty until later phases write data).
- **Activity feed** renders empty until Phase 3 and 4 modules populate data.

## Integration points used in Phase 2

| System | Direction | Used By | Notes |
|---|---|---|---|
| Azure AD / MSAL | Auth | Front-end → Functions | Token-based; no session cookies |
| Dataverse Web API | Read/Write | Functions backend | OBO token; OData queries; Business Unit RLS |
| Application Insights | Write | Functions backend | Error logging, request tracing |

Power Automate, Azure AI Foundry, M365 MCP, Fabric Data Agent, AI Builder, and Key Vault (PA shared secret) are not used in Phase 2 — they come online in Phases 3 and 4.
