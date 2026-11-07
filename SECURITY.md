# Security policy

Portico handles hotel operations, guest personal data and payment references. Security issues are treated as
the highest priority.

**Reporting a vulnerability:** email security@monoclay.example (placeholder — see OPEN_QUESTIONS) with steps
to reproduce. Do not open a public issue. We acknowledge within 2 business days (target).

**Engineering rules** (enforced in review, see CLAUDE.md §6): tenant isolation in the application *and* in
Postgres Row Level Security; deny-by-default permissions checked in the service layer; no raw card data
anywhere; no secrets or PII in logs; field-level encryption for identity documents; parameterized SQL only;
dependency and code scanning in CI.
