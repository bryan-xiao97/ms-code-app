# Sell-Side M&A Platform — Code App Technical Design Spec
_Date: 2026-05-20 | Revised: 2026-05-20 | Author: Bryan Xiao_

> This spec describes the Code App implementation of the sell-side M&A platform. The feature design (deal pipeline, workspace, Buyers module, DD Q&A, Overview tab) is identical to the Canvas App spec (`2026-05-19-sell-side-ma-platform-design.md`). This document covers the technical layer differences: React SPA, Azure Functions backend, Azure Static Web Apps hosting, and direct Dataverse/Foundry API calls.

## Key Decisions

| Decision | Resolution |
|---|---|
| Implementation path | **Code App** (this spec) — Canvas App spec superseded |
| Dataverse environment strategy | **Single shared environment** — all deals in one Dataverse environment; deal-level isolation via Business Units |
| Deal access control | **Dataverse Business Unit-based RLS** — each deal maps to a Business Unit; bankers are assigned to their deal's Business Unit; Dataverse enforces row-level access natively |
| Deal SharePoint site provisioning | **Manual** at engagement start — automation deferred (may move to another platform) |

---

## Problem Statement

Solomon Partners' sell-side M&A workflow involves significant manual, repetitive work across buyer research, due diligence response, and buyer relationship tracking. This platform design defines a code-first technical foundation that supports three AI-powered capabilities — Buyers (List Generation + Log), DD Q&A Management, and deal project management — while ensuring bankers retain ownership of judgment and direction.

The Code App approach is chosen over a Power Apps Canvas App to remove UI capability constraints on complex components (buyer table with inline editing, milestone timeline, activity feed) and to eliminate per-user Power Apps licensing requirements.

## Scope

**In scope:**
- React SPA front-end on Azure Static Web Apps
- Azure Functions API backend (Node.js / TypeScript)
- Authentication via MSAL (Azure AD) + managed identity
- Dataverse Web API integration (via Functions backend)
- Azure AI Foundry direct integration (via Functions backend) for DD Q&A
- Power Automate integration (via HTTP) for Buyer List generation and export
- Shared data connectivity layer (M365 MCP, Fabric/Dataverse, VDR staging) — unchanged from Canvas App spec
- Background Power Automate flows (Buyer Log monitoring) — unchanged from Canvas App spec
- Deal project management: stage tracking, milestone timelines
- Build sequencing and ALM

**Out of scope:**
- Module-level feature specs (covered in individual PRDs)
- DealCloud silver-layer semantic model design (owned by Max/Idris)
- VDR vendor evaluation or procurement
- Teams app packaging or SPFx embedding (possible future extension; not in scope for v1)

---

## Platform Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  FRONT-END                                                      │
│  React SPA (TypeScript)                                         │
│  Azure Static Web Apps                                          │
│  Auth: MSAL (Azure AD) — acquires token for Functions app       │
└───────────────────────────┬─────────────────────────────────────┘
                            │  HTTPS + Azure AD bearer token
┌───────────────────────────▼─────────────────────────────────────┐
│  API BACKEND                                                    │
│  Azure Functions (Node.js / TypeScript)                         │
│  Managed Identity → Dataverse Web API (read/write)              │
│  Managed Identity → Azure AI Foundry (DD Q&A RAG endpoint)      │
│  HTTP call → Power Automate (Buyer List generation, export)     │
└──────┬────────────────────┬────────────────────────┬────────────┘
       │                    │                        │
  Dataverse             Azure AI               Power Automate
  Web API               Foundry                HTTP flows
  (deals, buyers,       (RAG endpoint,         (Copilot Studio
   milestones,           DD Q&A)                orchestrator,
   QALog,                                       background Buyer
   BuyerComms)                                  Log monitoring)
```

```
┌─────────────────────────────────────────────────────────────────┐
│  DATA CONNECTIVITY LAYER  (shared — unchanged from Canvas spec) │
│                                                                  │
│  M365 MCP          Fabric Data Agent     Dataverse               │
│  (read)            (read — DealCloud     (read/write)            │
│                     via silver layer)                            │
└─────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  DATA SOURCES                                                    │
│  SharePoint  |  Outlook  |  Teams  |  DealCloud  |  VDR staging │
└─────────────────────────────────────────────────────────────────┘
```

---

## Dataverse Environment & Access Control

All deals share a single Dataverse environment. Deal-level data isolation is enforced via Dataverse Business Units — each deal maps to one Business Unit. Bankers are assigned to the Business Units corresponding to their active deals. Dataverse enforces row-level access natively; a banker cannot read or write records in a Business Unit they are not assigned to.

**On-Behalf-Of (OBO) flow:** The Functions app uses the Azure AD On-Behalf-Of flow to acquire a Dataverse token scoped to the authenticated user. Dataverse receives the user's identity and applies Business Unit-based RLS automatically — no deal-level filtering logic is required in the Functions app.

```
React SPA (user: banker A)
  → bearer token → Azure Functions
  → OBO flow: exchange token for Dataverse-scoped token (as banker A)
  → Dataverse Web API: enforces Business Unit RLS for banker A
  → Returns only records in banker A's assigned deals
```

**Business Unit provisioning:** When a deal is onboarded, a Dataverse administrator creates a Business Unit for the deal and assigns the relevant bankers. This is a manual admin step — no automated provisioning is required for v1.

---

## Authentication & Authorization

**Front-end (MSAL):**
The React SPA uses MSAL.js to authenticate the banker against Azure AD. On login, MSAL acquires an access token scoped to the Azure Functions app (`api://<functions-app-client-id>`). All API calls from the SPA include this token as a bearer token in the Authorization header.

**Backend (Managed Identity):**
The Azure Functions app uses a system-assigned managed identity to authenticate outbound calls to Dataverse and Azure AI Foundry. No API keys or secrets are stored in application code or environment variables for these resources. The managed identity is granted the minimum required Dataverse security role (scoped to read/write on the platform tables) and the Azure AI Foundry Inference role.

Power Automate HTTP-triggered flows use a shared secret (stored in Azure Key Vault, referenced via Functions app settings). The Functions app retrieves the secret at startup; it is never exposed to the front-end.

**Deal access control — Dataverse Business Units:**
Each deal maps to a Dataverse Business Unit. Bankers are assigned to their deal's Business Unit by a Dataverse administrator when they join the deal team. The Functions app uses the OBO flow to call Dataverse as the authenticated user — Dataverse enforces Business Unit-scoped RLS automatically. The deal list returned to the SPA contains only deals the authenticated banker is assigned to.

---

## Front-End Structure

The React SPA replicates the deal-centric UI defined in the Canvas App spec. Component structure:

```
src/
  pages/
    DealList.tsx          — home screen: deal pipeline list
    DealWorkspace.tsx     — deal workspace shell (header + tabs)
  components/
    tabs/
      Overview.tsx        — stage indicator, milestone timeline, activity feed
      Buyers.tsx          — buyer table (uninitialized + active states)
      DDQA.tsx            — question input + Q&A history
    shared/
      StageSelector.tsx   — deal stage dropdown (writes to /api/deals/{id})
      MilestoneList.tsx   — milestone CRUD with inline editing
      ActivityFeed.tsx    — merged event feed from /api/deals/{id}/activity
      BuyerTable.tsx      — buyer rows with inline status/notes editing
  services/
    api.ts                — typed fetch wrapper (attaches bearer token, handles errors)
  auth/
    msalConfig.ts         — MSAL configuration (client ID, authority, scopes)
```

The front-end holds no business logic beyond display and user interaction. All data operations go through `api.ts` → Azure Functions.

---

## Backend API Layer (Azure Functions)

All endpoints are HTTP-triggered Azure Functions. The Functions app enforces Azure AD token validation on every request (built-in auth via Easy Auth or manual JWT validation middleware).

| Endpoint | Method | Action |
|---|---|---|
| `/api/deals` | GET | List all deals from Dataverse |
| `/api/deals` | POST | Create deal record in Dataverse (name, target, sector, stage = Preparation) |
| `/api/deals/{id}` | PATCH | Update deal stage in Dataverse |
| `/api/deals/{id}/milestones` | GET | List milestones for deal |
| `/api/deals/{id}/milestones` | POST | Create milestone record in Dataverse |
| `/api/deals/{id}/milestones/{milestoneId}` | PATCH | Update milestone (name, date) |
| `/api/deals/{id}/milestones/{milestoneId}` | DELETE | Delete milestone record |
| `/api/deals/{id}/buyers` | GET | List buyer records for deal |
| `/api/deals/{id}/buyers` | POST | Add manual buyer record to Dataverse |
| `/api/deals/{id}/buyers/generate` | POST | Call PA flow → Copilot Studio orchestrator; write Buyers to Dataverse; return list |
| `/api/deals/{id}/buyers/{buyerId}` | PATCH | Update buyer status, notes, next steps |
| `/api/deals/{id}/qa` | GET | List Q&A log records for deal |
| `/api/deals/{id}/qa` | POST | Call Azure AI Foundry RAG endpoint; write QALog record; return answer + citations |
| `/api/deals/{id}/activity` | GET | Merge BuyerCommunications + QALog + Buyers (generation event) sorted by timestamp |
| `/api/deals/{id}/export` | POST | Trigger PA export flow; return SharePoint link or delivery confirmation |

**Route ordering note:** `/api/deals/{id}/buyers/generate` must be registered before `/api/deals/{id}/buyers/{buyerId}` in the Functions route config to prevent "generate" being matched as a buyer ID. In practice buyer IDs are Dataverse GUIDs, so there is no runtime conflict, but explicit ordering is the correct practice.

**Error handling:**
- Dataverse Web API errors (4xx, 5xx) are caught and returned as structured JSON `{ error: string, code: number }` to the front-end.
- Foundry and PA flow errors are caught; the Functions app returns a `502` with a user-readable message. The front-end displays the message inline rather than crashing.
- All errors are logged to Application Insights via the Functions app.

---

## Agent Integration

### Buyer List Generation (on-demand, via Power Automate)

The Copilot Studio orchestrator + Research Agent pattern is already built (ADO Epic 4031) and called via a Power Automate HTTP-triggered flow. The Functions backend calls this existing PA flow — no changes to the agent or flow logic. The Functions app passes deal context in the request body, receives structured buyer list JSON, writes Buyers records to Dataverse, and returns the list to the front-end.

```
React SPA
  → POST /api/deals/{id}/buyers/generate
  → Azure Functions
  → PA HTTP flow (existing)
  → Copilot Studio orchestrator + Research Agent
  → Returns buyer list JSON
  → Functions writes to Dataverse Buyers table
  → Returns buyer list to SPA
```

### DD Q&A (on-demand, direct to Azure AI Foundry)

The Functions app calls the Azure AI Foundry RAG endpoint directly using its managed identity. The RAG endpoint indexes the deal SharePoint site (VDR staged documents, client files) and M365 content. The Functions app passes the question and deal context, receives an answer with source citations, writes the QALog record to Dataverse, and returns the result to the front-end.

**SharePoint site provisioning:** The deal SharePoint site used by the Foundry index is provisioned manually by the deal team at engagement start. The site mirrors VDR folder structure for citation traceability.

**VDR staging:** Documents are staged manually from the VDR to the deal SharePoint site. A within-hours SLA has been identified as the target but manual staging is accepted for the v1 pilot. Automated VDR-to-SharePoint sync is deferred — see Open Questions for vendor options and target pattern.

```
React SPA
  → POST /api/deals/{id}/qa  { question: "..." }
  → Azure Functions
  → Azure AI Foundry RAG endpoint (managed identity)
  → Returns answer + citations
  → Functions writes to Dataverse QALog table
  → Returns answer + citations to SPA
```

### Buyer Log Auto-Recording (background, Power Automate)

Background PA flows monitor Outlook and Teams for communications with tracked buyers, summarize threads via AI Builder, and write BuyerCommunications records to Dataverse. These flows run independently of the front-end and Functions app — they are not triggered by user action. The Functions app surfaces their output via the `/api/deals/{id}/buyers` and `/api/deals/{id}/activity` endpoints.

---

## Data Model

Identical to the Canvas App spec. No schema changes are required for the Code App.

| Table | Written By | Read By |
|---|---|---|
| Deals | Functions (`/api/deals`) | All endpoints |
| Milestones | Functions (`/api/deals/{id}/milestones`) | Overview tab via `/api/deals/{id}/milestones` |
| Buyers | Functions (generate + manual add) | Buyers tab, activity feed |
| BuyerCommunications | Background PA flow (Buyer Log) | Buyers tab (last touch), activity feed |
| QALog | Functions (`/api/deals/{id}/qa`) | DD Q&A tab, activity feed |
| MeetingSummaries | Meeting capture workflow | Copilot agents (existing) |

**Dataverse access pattern:** The Functions app accesses Dataverse via the Web API using managed identity auth. All reads use OData queries filtered by deal ID. Writes use standard POST/PATCH operations. The front-end never calls Dataverse directly.

---

## Data Connectivity Layer

Unchanged from the Canvas App spec. M365 MCP, Fabric Data Agent, and VDR staging patterns are platform-level and independent of the front-end technology.

---

## Build Sequencing & ALM

**Repository structure:**
```
/
  frontend/         — React SPA (TypeScript, Vite or CRA)
  backend/          — Azure Functions app (Node.js / TypeScript)
  infra/            — Bicep or ARM templates (Static Web Apps, Functions, Key Vault)
  .azure-pipelines/ — Azure DevOps pipeline YAML
```

**CI/CD (Azure DevOps):**
- PR gate: lint + type-check + unit tests on both frontend and backend
- Main branch merge: build SPA → deploy to Azure Static Web Apps; build Functions → deploy to Azure Functions app
- Infrastructure changes: Bicep deployment gated on manual approval

**Build phases:**

```
Phase 1 — Infrastructure & Auth (prerequisite)
  - Provision Azure Static Web Apps, Azure Functions app, Key Vault
  - Configure managed identity → Dataverse and Foundry roles
  - Configure MSAL app registration (Azure AD)
  - Dataverse schema: Deals (Stage field), Milestones, Buyers,
    BuyerCommunications, QALog
  - Azure DevOps pipeline: lint/type-check/deploy gates

Phase 2 — Deal PM shell
  - Frontend: DealList, DealWorkspace shell, StageSelector
  - Backend: /api/deals (GET, POST, PATCH), /api/deals/{id}/milestones (all)
  - Frontend: Overview tab — stage indicator, milestone CRUD
  - Activity feed renders empty until modules populate data

Phase 3 — Buyers module
  - Backend: /api/deals/{id}/buyers (GET, POST), /buyers/generate, /{buyerId} PATCH
  - Backend: /api/deals/{id}/export
  - Frontend: Buyers tab (uninitialized + active states, inline editing, overdue indicators)
  - Background PA flows: Outlook/Teams monitoring → BuyerCommunications
  - Activity feed: BuyerCommunications + Buyers generation event

Phase 4 — DD Q&A
  - Azure AI Foundry index over deal SharePoint site
  - Backend: /api/deals/{id}/qa (GET, POST → Foundry)
  - Frontend: DD Q&A tab (question input, Q&A history, export)
  - Activity feed: QALog events added
  - Depends on VDR staging pattern being operationalized
```

---

## Integration Points

| System | Direction | Used By | Notes |
|---|---|---|---|
| Azure AD / MSAL | Auth | Front-end → Functions | Token-based; no session cookies |
| Dataverse Web API | Read/Write | Functions backend | Via managed identity; OData queries |
| Azure AI Foundry | Read | Functions backend (DD Q&A) | Direct REST call; managed identity |
| Power Automate HTTP flows | Read | Functions backend (Buyer List gen, export) | Shared secret in Key Vault |
| M365 MCP | Read | PA flows (Buyer Log), Copilot Studio (Buyer List) | Unchanged from Canvas spec |
| Fabric Data Agent / Silver Layer | Read | Copilot Studio (via PA flow) | DealCloud; RLS enforced; owned by Max/Idris |
| AI Builder | Read | Background PA flow (Buyer Log) | Summarizes Outlook/Teams threads |
| Application Insights | Write | Functions backend | Error logging, request tracing |
| Azure Key Vault | Read | Functions backend | PA flow shared secret |

---

## Comparison: Code App vs. Canvas App

| Dimension | Canvas App | Code App |
|---|---|---|
| UI framework | Power Fx / Studio | React / TypeScript |
| Hosting | Power Platform | Azure Static Web Apps |
| Backend | Power Automate (all calls) | Azure Functions + PA (hybrid) |
| Auth | Inherited from Power Platform | MSAL + managed identity |
| Dataverse access | Native connector | Web API via Functions |
| Licensing | Power Apps per-user or per-app required | No Power Apps license; PA licenses for background flows only |
| UI capability | Constrained (gallery, forms) | No ceiling |
| ALM | Power Platform solution + pac CLI | Azure DevOps CI/CD + Bicep |
| Build complexity | Lower | Higher (infra + code) |
| M365/Teams integration | Native | Manual (Teams app manifest if needed later) |

---

## Open Questions

- **VDR staging automation (deferred):** A within-hours SLA makes manual staging insufficient for steady-state DD use. Automation is required but deferred — different deals use different VDR platforms. When revisited, the three primary options are: **Intralinks** (REST API available), **Datasite** (API available), **Ansarada** (API available). Each supports programmatic document retrieval; a scheduled Power Automate flow or Azure Function polling the VDR API and syncing new documents to the deal SharePoint site is the target pattern. Vendor coverage and API consistency need evaluation before implementation.
- **Activity feed limit:** 10 most recent events. Fixed platform-wide.
- **Status thresholds (fixed platform-wide):** Milestone Due Soon = 5 days before due date; Buyer follow-up overdue = 14 days since last touch.
