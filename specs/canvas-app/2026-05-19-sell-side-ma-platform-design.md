# Sell-Side M&A Platform — Technical Design Spec
_Date: 2026-05-19 | Revised: 2026-05-20 | Author: Bryan Xiao_

---

## Problem Statement

Solomon Partners' sell-side M&A workflow involves significant manual, repetitive work across buyer research, due diligence response, and buyer relationship tracking. This platform design defines a shared technical foundation that supports three AI-powered capabilities — Buyers (List Generation + Log), DD Q&A Management, and deal project management — while ensuring bankers retain ownership of judgment and direction.

## Scope

This document is a **platform-level technical design** spanning all modules. Each module has (or will have) its own product spec and work items. This spec defines the shared infrastructure, cross-module data flows, and build sequencing.

**In scope:**
- Shared data connectivity layer (M365 MCP, Fabric/Dataverse, VDR staging)
- Agent/App layer design — deal-centric Canvas App with AI agents as backend
- Deal project management: stage tracking, milestone timelines
- Cross-module data flows including the Buyer List → Buyer Log handoff
- Integration points and build sequencing

**Out of scope:**
- Module-level feature specs (covered in individual PRDs)
- DealCloud silver-layer semantic model design (owned by Max/Idris)
- VDR vendor evaluation or procurement

---

## Platform Architecture

The platform has two stable layers and one flexible layer.

```
┌─────────────────────────────────────────────────────────────────┐
│  AGENT / APP LAYER  (flexible — varies by module)               │
│  Power Apps Canvas App (deal-centric unified front-end)         │
│  Copilot Studio  |  Azure AI Foundry  |  Power Automate        │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  DATA CONNECTIVITY LAYER  (shared platform)                      │
│                                                                  │
│  M365 MCP          Fabric Data Agent     Dataverse               │
│  (read)            (read — DealCloud     (read/write)            │
│                     via silver layer)                            │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│  DATA SOURCES                                                    │
│  SharePoint  |  Outlook  |  Teams  |  DealCloud  |  VDR staging │
└─────────────────────────────────────────────────────────────────┘
```

### Module Summary

| Module | Agent/App Layer | Primary Data Read | Primary Data Write |
|---|---|---|---|
| Buyers (List + Log) | Copilot Studio (on-demand) + Power Automate (background) | M365 MCP, Fabric/DealCloud | Dataverse (buyer records, communication events), Excel/Word export |
| DD Q&A | Azure AI Foundry + Power Automate | M365 MCP (incl. VDR staging site), Dataverse | Dataverse (Q&A log) |
| Deal PM | Power Apps + Dataverse | Dataverse (deals, milestones) | Dataverse (stage, milestones) |

---

## Data Connectivity Layer

### M365 MCP (read)

Single shared connector providing all modules with read access to SharePoint, Outlook, and Teams. The VDR integration runs through this layer via a deal-specific SharePoint staging site.

**VDR staging pattern:**

```
VDR (Intralinks / Ansarada / Datasite)
         │
         │  deal team stages relevant docs at engagement start
         │  (manual initially; Power Automate automation if VDR API supports it)
         ▼
Deal SharePoint Site  ──►  M365 MCP  ──►  DD Q&A Agent
(folder structure mirrors VDR paths                reads like any
 for citation traceability)                        other SharePoint
```

The staging site mirrors the VDR folder structure so document citations in agent responses map back to VDR source paths.

### Fabric Data Agent / Silver Layer (read)

Shared connected agent sitting over the DealCloud silver-layer semantic model (Max/Idris). All modules requiring DealCloud data call this agent — no module connects to DealCloud directly. RLS is enforced at the semantic model level, ensuring consistent access control regardless of which module is calling.

### Dataverse (read/write)

The operational data store for the platform. Core tables:

| Table | Written By | Read By |
|---|---|---|
| Deals | Power Apps (New Deal form, stage updates) | All modules |
| Milestones | Power Apps (Overview tab) | Overview tab (activity feed, next milestone display) |
| Buyers | Buyers module (via PA flow on list generation) | Buyers tab, Overview activity feed |
| BuyerCommunications | Buyer Log background PA flow | Buyers tab, Overview activity feed |
| QALog | DD Q&A (via PA flow) | DD Q&A tab, Overview activity feed |
| MeetingSummaries | Meeting capture workflow | Copilot agents (existing) |

---

## Agent / App Layer

### Canvas App: Deal-Centric PM Application

The Canvas App is a deal project management application. Bankers interact with a structured app UI — not a chat window. Copilot Studio and Azure AI Foundry are execution environments only; they have no user-facing interface.

The app has two levels: a deal pipeline list (home screen) and a deal workspace (per-deal).

#### Home Screen: Deal Pipeline List

The home screen shows all active deals in a list. Each row displays deal name, current stage, next milestone (name + date), and a status indicator derived from milestone dates (On Track / At Risk / Overdue). Bankers can filter by stage. A "New Deal" button creates a new Deals record in Dataverse.

```
┌─────────────────────────────────────────────────────────────────┐
│  Solomon M&A                                    [+ New Deal]    │
├─────────────────────────────────────────────────────────────────┤
│  All Stages ▼                                                   │
├──────────────┬────────────────┬──────────────┬──────────────────┤
│  Deal        │  Stage         │  Next        │  Status          │
│              │                │  Milestone   │                  │
├──────────────┼────────────────┼──────────────┼──────────────────┤
│  Project Oak │  Marketing     │  IOI Due     │  ● On Track      │
│              │                │  Jun 3       │                  │
│  Project     │  First Round   │  Bid Due     │  ⚠ At Risk       │
│  Maple       │                │  May 28      │                  │
│  Project     │  Preparation   │  CIM Draft   │  ● On Track      │
│  Cedar       │                │  Jun 10      │                  │
└──────────────┴────────────────┴──────────────┴──────────────────┘
```

Milestone status thresholds: Due Soon = due within 5 calendar days; Overdue = past due date. At Risk is shown on the deal row if any milestone is Due Soon or Overdue.

#### Deal Workspace

Clicking a deal opens the workspace. A persistent header shows deal name, a stage selector (dropdown: Preparation / Marketing / First Round / Final Round / Closed), and the next upcoming milestone date. Stage changes write directly to the Deals table in Dataverse — no workflow is triggered; stage is a status field, not a gate.

Below the header, three tabs: **Overview | Buyers | DD Q&A**.

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Deals   Project Oak                                          │
│            Stage: [Marketing ▼]          Next: IOI Due Jun 3   │
├─────────────────────────────────────────────────────────────────┤
│  Overview   Buyers   DD Q&A                                     │
├─────────────────────────────────────────────────────────────────┤
│  [tab content]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Overview Tab

Three components:

**Stage indicator** — horizontal pipeline showing all five stages with the current stage highlighted.

**Milestone timeline** — list of milestones for the deal (name, due date, status). Bankers add and edit milestones inline; each write goes to the Milestones table in Dataverse. Status is calculated from the due date at render time.

**Activity feed** — reverse-chronological read-only feed of recent deal events. Populated by merging records from BuyerCommunications (communication events auto-recorded by background PA flows), QALog (DD questions answered), and Deals/Milestones (stage changes, milestone additions). Merged and sorted by timestamp client-side in the Canvas App.

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage                                                          │
│  [Preparation]──[● Marketing]──[First Round]──[Final]──[Closed] │
├─────────────────────────────────────────────────────────────────┤
│  Milestones                                    [+ Add]          │
│  IOI Due          Jun 3   ● Upcoming                            │
│  Mgmt Pres        Jun 17  ● Upcoming                            │
│  Bid Deadline     Jul 8   ● Upcoming                            │
├─────────────────────────────────────────────────────────────────┤
│  Recent Activity                                                │
│  May 19  Blackstone — email received (auto)                     │
│  May 18  DD Q&A — 3 questions answered                          │
│  May 16  Buyer list generated — 24 buyers                       │
└─────────────────────────────────────────────────────────────────┘
```

#### Buyers Tab

The Buyers tab unifies buyer list generation and buyer log tracking into a single module. Buyer list generation is the seeding step; the buyer log is the ongoing state.

**Uninitialized state** (no buyers generated yet): the tab shows a "Generate Buyer List" prompt. The banker inputs deal context (target company description, ideal buyer criteria); the Canvas App triggers a Power Automate flow that calls the Copilot Studio orchestrator. The orchestrator runs the Research Agent, which queries M365 MCP, the Fabric Data Agent (DealCloud), and web search. The orchestrator returns structured buyer list JSON; the flow writes one Buyers record per buyer to Dataverse (status = "Identified / Not Contacted") and returns the list to the Canvas App.

**Active state** (buyers present): the tab shows a buyer table. Background Power Automate flows continuously monitor Outlook and Teams for communications with tracked buyers; AI Builder summarizes threads and writes BuyerCommunications records to Dataverse, which surface as "Last Touch" updates in the table. Bankers update buyer status and notes directly in the table; each edit writes to Dataverse. Export triggers a Power Automate flow that generates Excel/Word output.

```
┌─────────────────────────────────────────────────────────────────┐
│  [Generate Buyer List]   [Export]                               │
├──────────────┬───────────┬──────────────┬───────────────────────┤
│  Buyer       │  Status   │  Last Touch  │  Next Step            │
├──────────────┼───────────┼──────────────┼───────────────────────┤
│  KKR         │  Contacted│  May 18 (auto│  Follow up Jun 1      │
│  Blackstone  │  Identified│  —          │  Send teaser          │
│  Apollo      │  IOI Rec'd│  May 19 (auto│  Schedule mgmt pres   │
└──────────────┴───────────┴──────────────┴───────────────────────┘
```

Buyers added manually (not surfaced by the agent) are supported — bankers can add a buyer row directly to the table.

#### DD Q&A Tab

Two areas:

**Question input** — text field where the banker types a due diligence question and submits. Triggers a Power Automate flow that calls the Azure AI Foundry RAG endpoint. Foundry retrieves relevant chunks from the deal SharePoint site (VDR staged documents, client files) and M365 content (emails, meeting notes, Teams), synthesizes an answer with source citations, and returns it. The flow writes the Q&A record to the QALog table in Dataverse.

**Q&A history** — reverse-chronological log of all questions and answers for this deal. Each entry shows question, answer, and expandable source citations (document name + page/section reference). Bankers can export the full log.

```
┌─────────────────────────────────────────────────────────────────┐
│  Ask a due diligence question                                   │
│  ┌─────────────────────────────────────────────────────┐ [Ask] │
│  │ What IP does the target hold related to...          │       │
│  └─────────────────────────────────────────────────────┘       │
├─────────────────────────────────────────────────────────────────┤
│  Q&A History                                   [Export Log]     │
│                                                                 │
│  May 18 — What are the key customer concentration risks?        │
│  ▶ Answer: Top 3 customers represent 61% of revenue...          │
│    Sources: CIM p.14, Customer Contract Summary.docx            │
│                                                                 │
│  May 17 — Does the target have any pending litigation?          │
│  ▶ Answer: One disclosed matter in the data room...             │
│    Sources: Legal Due Diligence Memo.pdf                        │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Architecture Summary

```
┌──────────────────────────────────────────────────────────────────┐
│         Power Apps Canvas App                                    │
│  ┌──────────┐  ┌───────────────────────────┐  ┌──────────────┐  │
│  │ Overview │  │ Buyers                    │  │  DD Q&A      │  │
│  │ (PM)     │  │ (List gen + Log)          │  │              │  │
│  └──────────┘  └────────────┬──────────────┘  └──────┬───────┘  │
└───────────────────────────  │  ──────────────────────│──────────┘
                              │                        │
              ┌───────────────┴──────┐    ┌────────────┴──────────┐
              │ On-demand            │    │ On-demand             │
              │ Copilot Studio       │    │ Azure AI Foundry      │
              │ (via PA flow)        │    │ RAG (via PA flow)     │
              └──────────────────────┘    └───────────────────────┘
              │ Background                                         │
              │ Power Automate                                     │
              │ (Outlook/Teams monitoring → BuyerCommunications)  │
              └────────────────────────────────────────────────────
```

---

## Data Flows

### New Deal Creation

```
1. Banker clicks "+ New Deal" in Canvas App
2. Inputs deal name, target company, sector
3. Canvas App writes Deals record to Dataverse (stage = "Preparation")
4. Deal appears in pipeline list; workspace is ready for use
```

### Buyers: List Generation (on-demand)

```
1. Banker opens Buyers tab on uninitialized deal → inputs deal context
2. Canvas App triggers Power Automate flow
3. Flow calls Copilot Studio orchestrator
4. Research agent iterates:
   - M365 MCP: emails, SharePoint, Teams (internal signals)
   - Fabric Data Agent: DealCloud deal history (RLS enforced)
   - Web search: external buyer candidates
5. Orchestrator returns structured buyer list JSON
6. Flow writes Buyers records to Dataverse (one per buyer, status = "Identified / Not Contacted", linked to deal ID)
7. Flow returns result to Canvas App → Buyers tab displays active state
```

### Buyers: Log Auto-Recording (background)

```
Background (continuous):
1. Power Automate monitors Outlook + Teams for communications with tracked buyers (matched by email domain / contact name against Dataverse Buyers records)
2. On match: AI Builder summarizes thread
3. Writes BuyerCommunications record to Dataverse (buyer ID, date, direction, summary, banker)
4. Canvas App reflects updated "Last Touch" on next load

Foreground (banker-driven):
5. Banker updates buyer status, notes, next steps in Buyers tab → writes to Dataverse
6. Canvas App surfaces buyers with no contact past a defined threshold (overdue follow-up indicator)
```

### Buyers: Export (on-demand)

```
1. Banker clicks Export in Buyers tab
2. Canvas App triggers Power Automate flow
3. Flow generates Excel/Word output from Dataverse Buyers records
4. Delivered via SharePoint link or email
```

### DD Q&A

```
1. Banker opens DD Q&A tab → types due diligence question
2. Canvas App triggers Power Automate flow
3. Flow calls Azure AI Foundry RAG engine:
   - Retrieves relevant chunks from deal SharePoint site (VDR staged docs + client files)
   - Retrieves relevant chunks from M365 (emails, meeting notes, Teams)
   - Optionally queries Dataverse for DealCloud deal context
4. Foundry synthesizes answer + source citations
5. Flow writes Q&A record to Dataverse (question, answer, citations, banker, timestamp)
6. Flow returns answer + citations to Canvas App → displayed in Q&A history
```

### Overview Activity Feed

```
On tab load:
1. Canvas App queries Dataverse in parallel:
   - BuyerCommunications: last N events for this deal, sorted by date desc
   - QALog: last N records for this deal, sorted by date desc
   - Buyers: earliest CreatedOn record for this deal (surfaces as
     "Buyer list generated — X buyers" event using record count)
2. Canvas App merges results by timestamp and renders feed
(No dedicated ActivityFeed table — merged client-side at render time.
 Stage change history is not tracked in v1; no audit table in scope.)
```

---

## Integration Points

| System | Direction | Used By | Notes |
|---|---|---|---|
| M365 MCP | Read | Buyers, DD Q&A | SharePoint, Outlook, Teams; single shared connector |
| Fabric Data Agent / Silver Layer | Read | Buyers, DD Q&A | DealCloud via semantic model; RLS enforced; owned by Max/Idris |
| Dataverse | Read/Write | All modules | Deals, Milestones, Buyers, BuyerCommunications, QALog |
| Azure AI Foundry | Read | DD Q&A | RAG engine; called via Power Automate or HTTP connector |
| Copilot Studio | Execution | Buyers (list gen) | Orchestrator + research agents; called via Power Automate or HTTP |
| VDR (Intralinks / Ansarada / Datasite) | Staged | DD Q&A | Deal teams export relevant docs to deal SharePoint site at engagement start |
| AI Builder | Read | Buyers (background log) | Summarizes Outlook/Teams threads before writing to BuyerCommunications |
| Office (Excel / Word) | Write | Buyers (export) | Export output generated by Power Automate |

---

## Build Sequencing

The data connectivity layer must be established before any module goes to production.

```
Phase 1 — Shared platform (prerequisite for all modules)
  - Dataverse schema: Deals (incl. Stage field), Milestones, Buyers,
    BuyerCommunications, QALog
  - M365 MCP connector configured and validated
  - Fabric Data Agent / silver layer (in progress — Max/Idris)
  - Deal SharePoint site template (VDR staging folder structure)

Phase 2 — Canvas App shell + Deal PM
  - Deal pipeline list screen (home)
  - Deal workspace shell: header (name, stage selector, next milestone),
    tab navigation (Overview | Buyers | DD Q&A)
  - Overview tab: stage indicator, milestone CRUD, activity feed
    (feed renders empty until modules populate data)

Phase 3 — Buyers module (builds on ADO Epic 4031)
  - Add Dataverse write step to existing Copilot Studio output flow
  - Buyers tab: uninitialized state (Generate Buyer List trigger)
  - Buyers tab: active state (buyer table, status/notes editing, overdue indicators)
  - Background PA flows: Outlook/Teams monitoring → BuyerCommunications
  - Export flow: Excel/Word generation
  - Activity feed populated from BuyerCommunications

Phase 4 — DD Q&A
  - Azure AI Foundry index over deal SharePoint site
  - PA flow: call Foundry → write QALog to Dataverse
  - DD Q&A tab: question input + Q&A history + export
  - Depends on VDR staging pattern being operationalized
  - Activity feed populated from QALog
```

DD Q&A is Phase 4 because it depends on the VDR staging pattern being operationalized and Azure AI Foundry indexing being stood up — both have more unknowns than the Buyers module.

---

## Open Questions

- What is the Dataverse environment strategy — shared environment for all deals, or per-deal environments? Affects RLS design and data isolation.
- How is the deal SharePoint site provisioned — manually per engagement, or automated via Power Automate on deal creation in the Canvas App?
- What is the VDR staging SLA — how quickly must documents appear in the deal SharePoint site after being uploaded to the VDR? Does this need automation or is manual staging acceptable for the pilot?
- Does the Canvas App require row-level security to scope deal data per banker, or do all deal-team members see all deals?
- Which VDR vendor(s) are in use at Solomon Partners today? Determines whether VDR staging automation is feasible (API availability varies by vendor).
- How many activity feed items should the Overview tab render? Needs a defined limit (e.g., last 20 events) to keep the client-side merge performant.
- Should milestone status thresholds (Due Soon = 5 days) be configurable per deal type, or fixed platform-wide?
- What is the buyer follow-up overdue threshold — how many days without contact before a buyer is flagged as overdue in the Buyers tab? Fixed platform-wide or configurable per deal?
