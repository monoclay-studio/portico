# ADR-0011: AWS deployment topology

**Status:** Proposed (nothing deployed; owner authorization required) · **Date:** 2026-11-07

## Context

Owner chose AWS (D6). Needs 24/7 reliability, encryption, backups that are restore-tested, and future data residency.

## Decision

ECS Fargate (api, worker), Aurora PostgreSQL Multi-AZ with PITR, S3 + KMS, CloudFront + WAF, Secrets Manager, SES, CloudWatch + OpenTelemetry. Terraform with one state per environment; region default `ap-south-1` (Q4); cell-ready for more regions. Zero resources until the owner authorizes spend.

## Consequences

Managed services reduce operational load; cost model in docs/readiness/cost-model.md.
