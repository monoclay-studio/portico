# ADR-0013: Web applications: React SPA, shared design system, offline-capable staff PWA

**Status:** Accepted · **Date:** 2026-11-07

## Context

Desk staff need dense, keyboard-first screens; mobile staff need touch-first, offline-tolerant tools; guests need fast, accessible booking.

## Decision

React 19 + Vite + TanStack Router/Query + Tailwind, a Portico design system in `packages/ui` (accessible primitives, status badges with provenance, tables, timeline, command palette). Back office is an SPA; the staff app is a PWA with an offline queue and explicit sync status; the guest journey is server-rendered for SEO and performance (later wave). Contracts are imported from modules' `contracts.ts`.

## Consequences

Shared types end-to-end; one component vocabulary across surfaces.
