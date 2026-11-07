# Spec: ai

Status: Draft v1 · 2026-11-07 · Wave 3 · Schema `ai` · Prefix `AI` · Entitlement `ai.assistant` (metered add-on,
`usage.aiCredits`)

## 1. Purpose

Help staff find information, summarize a stay or a shift, draft replies, notice anomalies and propose actions —
while **never** inventing a payment outcome, availability, policy or confirmed reservation, always citing the records
it used, respecting the user's permissions exactly, and never being in the critical path (brief §14; vision
"No AI in the critical path").

## 2. Scope and non-goals

**In scope:** assistant sessions, permission-aware retrieval through module query APIs (tools), cited answers,
summaries (stay, booking, handover, guest history), drafting (messages, notes), anomaly detection suggestions,
action proposals that execute only through normal module commands with preview and user confirmation, prompt-
injection defenses, budgets and provider abstraction, evaluation.
**Non-goals:** autonomous actions with consequences; training models on customer data; storing PAN/identity
documents in prompts; replacing reports (`analytics`) or search (`platform`/module search).

## 3. Capabilities

- **AI-R01** [MUST] The assistant acts **as the user** (actor `{user, via:'ai'}`) with the user's permissions and
  property scope; tools are the same service APIs the UI uses; no direct database access; no cross-tenant retrieval.
- **AI-R02** [MUST] Every factual statement about a guest, booking, policy, balance, availability, payment or report
  cites the source records (type, id, field, provenance, freshness); if a tool cannot answer, the assistant says so —
  it does not guess. Facts that change (availability, payment status) are always fetched live, never from memory.
- **AI-R03** [MUST] Outputs are labelled **suggestion** (drafts, recommended actions, anomaly findings) and visually
  distinct from facts (ux-principles §3).
- **AI-R04** [MUST] **Action proposals**: structured proposals (e.g. "move stay K7P2 to villa 214 from 12 Mar",
  "send payment request for USD 420") rendered by the owning module's change preview; executing requires the user's
  explicit confirmation and the normal permission; consequential actions (money, inventory, guest messages) are
  never auto-executed.
- **AI-R05** [MUST] **Untrusted input**: guest messages, imported documents, external data and web content are
  delimited as data; they cannot add tools, change instructions, or cause disclosure; tool outputs are filtered to the
  user's permitted fields; no outbound URL fetches or data exfiltration paths.
- **AI-R06** [MUST] Data minimization: identity documents, payment tokens/card data, secrets never enter prompts;
  sensitive categories (health) only when the user holds `guests.sensitive.read` and the feature requires it.
- **AI-R07** [MUST] Budget: per-organization hard cap and notifications (`usage.aiCredits`); cap reached → the
  assistant is unavailable with an explanation; every product workflow continues without it (E14).
- **AI-R08** [MUST] Environment: `ai.inference` simulated in demo/trial/training (deterministic canned responses
  labelled simulated) unless the owner enables a paid provider for that environment; live inference only with an
  authorized provider account (readiness §14; Q45).
- **AI-R09** [MUST] Provider-agnostic model port; prompts, tool calls and outputs logged for audit with PII redaction;
  retention per policy; organization can disable AI entirely.
- **AI-R10** [SHOULD] Summaries: stay summary (status, open issues, preferences, balance), handover summary (from
  RES-R37 items), guest history; anomaly suggestions (unusual adjustments/write-offs, rate entries far from neighbours,
  repeated failed payments, discrepancies spikes) each with evidence links.
- **AI-R11** [SHOULD] Evaluation suite: citation accuracy, refusal when data missing, permission leakage tests,
  injection tests from guest-message corpora; run on every model/prompt change.

## 4. Entities and states

`session(id, user_id, property_id?, created_at)` · `turn(id, session_id, role, content_redacted, citations jsonb,
tool_calls jsonb, cost)` · `proposal(id, session_id, module, command, payload, preview_ref?, status)` ·
`eval_run(...)`. **Proposal:** `drafted → previewed → confirmed → executed | failed` · `drafted|previewed →
dismissed | expired`.

## 5. Invariants

- **AI-I01** No tool call returns data the user could not read through the UI.
- **AI-I02** No consequential command executes without a user confirmation event linked to the proposal.
- **AI-I03** Every answer containing a record-derived fact has ≥ 1 citation.
- **AI-I04** Prompts never contain PAN, CVC, identity document numbers or credentials (redaction test).
- **AI-I05** With AI disabled or capped, all critical workflows pass their scenario tests unchanged.

## 6. Cross-module interactions

Reads via module query APIs (reservations, guests, finance, payments, inventory, operations, comms, analytics);
proposes via module preview/commit APIs; uses `platform` (usage, environment, entitlements) and `identity`
(permissions). Domain map: `ai` owns sessions, retrieval, cited answers, proposals.

## 7. Events

`ai.proposal.confirmed|executed|dismissed`, `ai.usage.recorded`. Consumes `platform.usage.thresholdReached`.

## 8. Permissions

Implemented in role templates: `ai.assistant.use`. Defined: `ai.assistant.use` · `ai.proposal.execute` (still
requires the target permission) · `ai.settings.manage` ⚑ (org) · `ai.audit.read` ⚑ (org).

## 9. UX surfaces

Assistant side panel with record context; answers with inline citation chips and provenance; proposal cards that open
the module's change preview; drafting inside comms composer; "Why?" links on anomaly suggestions.

## 10. Proof scenarios and evidence

| ID | AI must demonstrate |
|---|---|
| E14 | AI budget exhausted: assistant unavailable; reservations, payments, Day Close unaffected. |
| S17 / E09 | Asking about another property/tenant's guest returns no data. |
| E15 (supporting) | Assistant summary of an error's history cites the audit records. |
| AI eval | Injection via guest message ("ignore instructions and refund…") produces no proposal and is flagged. |

## 11. Maldives specifics

Multilingual guest messages (translation drafting with originals preserved); transfer-disruption summaries for guest
relations; low-bandwidth: assistant is optional and never blocks screens.

## 12. Competitive inspirations

Apaleo MCP server and Agent Hub; Mews and Cloudbeds AI investments ("Ask Signals" over unified data) — AI value comes
from trustworthy unified data (research 02 §3.1, §8 item 15; research 03 §3.1, §14 item 15).

## 13. Open questions

Q45 (usage cost pass-through). Provider choice and live inference account need owner authorization (readiness §14).

## 14. Adoption modes

- **Standalone alongside an external PMS:** yes, over whatever data Portico holds (mirrored or owned), with provenance
  and freshness in every citation.
- **Hard dependencies:** `platform`, `identity`, at least one data-holding module.
- **Connected mode:** proposals for domains with external authority become **forwarded** commands (pending until
  acknowledged) or are not offered (read-only authority).
- **Data-authority domains:** owns none; respects all.
- **Trial:** simulated by default; answers cite `copied` data.
