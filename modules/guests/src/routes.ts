import { type PorticoDatabase, runIdempotent, type TxContext, withTenantTx } from '@portico/db';
import { type HttpModule, idParams, requireIdempotencyKey, requireIfMatch, setVersion } from '@portico/http';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  alertInput,
  companyContactInput,
  companyInput,
  companyKind,
  companyStatus,
  companyUpdate,
  companyView,
  consentInput,
  consentPurpose,
  consentState,
  contactPointInput,
  createProfileInput,
  createProfileResult,
  dismissInput,
  documentInput,
  duplicateCandidateView,
  guestProfile,
  legalHoldInput,
  mergeInput,
  mergePreview,
  mergeView,
  noteInput,
  preferenceInput,
  privacyRequestInput,
  privacyRequestView,
  recognitionSummary,
  relationshipInput,
  revealedDocument,
  revealInput,
  searchQuery,
  searchResult,
  specialNeedInput,
  stayHistoryView,
  unmergeInput,
  unmergePreview,
  updateProfileInput,
} from './contracts';
import type { GuestsService } from './service';

const propertyQuery = z.object({ propertyId: z.uuid().optional() });
const reasonBody = z.object({ reason: z.string().trim().min(3).max(300) });
const consentDecision = z.object({
  profileId: z.uuid(),
  legalEntityId: z.uuid(),
  purpose: consentPurpose,
  state: consentState,
  legalBasis: z.string(),
  mayProcess: z.boolean(),
  changedAt: z.string().nullable(),
});
const alertCreated = z.object({ alertId: z.uuid(), profile: guestProfile });
const noteCreated = z.object({ noteId: z.uuid(), profile: guestProfile });

/** HTTP surface of the guests module (mounted under /v1). Thin: every rule lives in the service. */
export function guestsHttp(deps: { database: PorticoDatabase; service: GuestsService }): HttpModule {
  const { database, service: svc } = deps;
  const tags = ['Guests'];

  const tx = <T>(req: FastifyRequest, fn: (tx: TxContext) => Promise<T>) =>
    withTenantTx(database, req.ctx, fn);
  /** Create / consequential command with a required Idempotency-Key (retries replay the stored response). */
  const idem = async <T>(
    req: FastifyRequest,
    reply: FastifyReply,
    scope: string,
    fn: (tx: TxContext) => Promise<T>,
    status = 201,
  ): Promise<T> => {
    const key = requireIdempotencyKey(req);
    const res = await runIdempotent(
      database,
      req.ctx,
      { scope, key, request: req.body ?? null },
      async (t) => ({
        status,
        body: await fn(t),
      }),
    );
    reply.status(res.status);
    if (res.replayed) reply.header('Idempotent-Replayed', 'true');
    return res.body;
  };
  const withEtag = <T extends { version: number }>(reply: FastifyReply, body: T): T => {
    setVersion(reply, body.version);
    return body;
  };

  return {
    name: 'guests',
    routes(app) {
      // ───────────── Profiles ─────────────
      app.post(
        '/guests/profiles',
        {
          schema: {
            tags,
            body: createProfileInput,
            response: { 201: createProfileResult, 200: createProfileResult },
          },
        },
        async (req, reply) => {
          const body = await idem(req, reply, 'POST /guests/profiles', (t) => svc.createProfile(t, req.body));
          setVersion(reply, body.profile.version);
          return body;
        },
      );

      app.get(
        '/guests/profiles/:id',
        { schema: { tags, params: idParams, querystring: propertyQuery, response: { 200: guestProfile } } },
        async (req, reply) =>
          withEtag(
            reply,
            await tx(req, (t) =>
              svc.getProfile(t, req.params.id, { propertyId: req.query.propertyId ?? null }),
            ),
          ),
      );

      app.patch(
        '/guests/profiles/:id',
        { schema: { tags, params: idParams, body: updateProfileInput, response: { 200: guestProfile } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          return withEtag(
            reply,
            await tx(req, (t) => svc.updateProfile(t, req.params.id, expected, req.body)),
          );
        },
      );

      app.get(
        '/guests/profiles/:id/history',
        {
          schema: { tags, params: idParams, querystring: propertyQuery, response: { 200: stayHistoryView } },
        },
        (req) =>
          tx(req, (t) => svc.getStayHistory(t, req.params.id, { propertyId: req.query.propertyId ?? null })),
      );

      app.get(
        '/guests/profiles/:id/recognition',
        {
          schema: {
            tags,
            params: idParams,
            querystring: z.object({ propertyId: z.uuid() }),
            response: { 200: recognitionSummary },
          },
        },
        (req) =>
          tx(req, (t) =>
            svc.getRecognitionSummary(t, { profileId: req.params.id, propertyId: req.query.propertyId }),
          ),
      );

      // ───────────── Contact points, preferences, alerts, notes, relationships ─────────────
      app.post(
        '/guests/profiles/:id/contact-points',
        {
          schema: {
            tags,
            params: idParams,
            body: contactPointInput.extend({ propertyId: z.uuid().optional() }),
            response: { 201: guestProfile },
          },
        },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/contact-points`, (t) =>
            svc.addContactPoint(t, req.params.id, req.body),
          ),
      );
      app.post(
        '/guests/contact-points/:id/verify',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ method: z.string().min(1).max(60), propertyId: z.uuid().optional() }),
            response: { 200: guestProfile },
          },
        },
        (req) => tx(req, (t) => svc.verifyContactPoint(t, req.params.id, req.body)),
      );
      app.delete(
        '/guests/contact-points/:id',
        { schema: { tags, params: idParams, querystring: propertyQuery, response: { 200: guestProfile } } },
        (req) =>
          tx(req, (t) =>
            svc.removeContactPoint(
              t,
              req.params.id,
              req.query.propertyId ? { propertyId: req.query.propertyId } : {},
            ),
          ),
      );

      app.post(
        '/guests/profiles/:id/preferences',
        {
          schema: {
            tags,
            params: idParams,
            body: preferenceInput.extend({ propertyId: z.uuid().optional() }),
            response: { 201: guestProfile },
          },
        },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/preferences`, (t) =>
            svc.addPreference(t, req.params.id, req.body),
          ),
      );
      app.patch(
        '/guests/preferences/:id',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ value: z.string().trim().min(1).max(300), propertyId: z.uuid().optional() }),
            response: { 200: guestProfile },
          },
        },
        (req) => {
          const expected = requireIfMatch(req);
          return tx(req, (t) => svc.updatePreference(t, req.params.id, expected, req.body));
        },
      );
      app.delete(
        '/guests/preferences/:id',
        { schema: { tags, params: idParams, querystring: propertyQuery, response: { 200: guestProfile } } },
        (req) =>
          tx(req, (t) =>
            svc.removePreference(
              t,
              req.params.id,
              req.query.propertyId ? { propertyId: req.query.propertyId } : {},
            ),
          ),
      );

      app.post(
        '/guests/profiles/:id/alerts',
        { schema: { tags, params: idParams, body: alertInput, response: { 201: alertCreated } } },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/alerts`, (t) =>
            svc.addAlert(t, req.params.id, req.body),
          ),
      );
      app.post(
        '/guests/alerts/:id/resolve',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ reason: z.string().max(300).optional(), propertyId: z.uuid().optional() }),
            response: { 200: guestProfile },
          },
        },
        (req) => {
          const expected = requireIfMatch(req);
          return tx(req, (t) =>
            svc.resolveAlert(t, req.params.id, expected, {
              ...(req.body.reason ? { reason: req.body.reason } : {}),
              ...(req.body.propertyId ? { propertyId: req.body.propertyId } : {}),
            }),
          );
        },
      );

      app.post(
        '/guests/profiles/:id/notes',
        { schema: { tags, params: idParams, body: noteInput, response: { 201: noteCreated } } },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/notes`, (t) =>
            svc.addNote(t, req.params.id, req.body),
          ),
      );
      app.post(
        '/guests/notes/:id/revisions',
        {
          schema: {
            tags,
            params: idParams,
            body: z.object({ body: z.string().trim().min(1).max(4000) }),
            response: { 201: noteCreated },
          },
        },
        (req, reply) =>
          idem(req, reply, `POST /guests/notes/${req.params.id}/revisions`, (t) =>
            svc.reviseNote(t, req.params.id, req.body),
          ),
      );

      app.post(
        '/guests/profiles/:id/relationships',
        {
          schema: {
            tags,
            params: idParams,
            body: relationshipInput.extend({ propertyId: z.uuid().optional() }),
            response: { 201: guestProfile },
          },
        },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/relationships`, (t) =>
            svc.addRelationship(t, req.params.id, req.body),
          ),
      );

      // ───────────── Consent ─────────────
      app.post(
        '/guests/profiles/:id/consents',
        { schema: { tags, params: idParams, body: consentInput, response: { 201: consentDecision } } },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/consents`, (t) =>
            svc.recordConsent(t, req.params.id, req.body),
          ),
      );
      app.get(
        '/guests/profiles/:id/consents/history',
        { schema: { tags, params: idParams } },
        async (req) => ({
          items: await tx(req, (t) => svc.consentHistory(t, req.params.id)),
        }),
      );

      // ───────────── Sensitive: documents, special needs, legal hold ─────────────
      app.post(
        '/guests/profiles/:id/documents',
        {
          schema: {
            tags,
            params: idParams,
            body: documentInput,
            response: { 201: z.object({ documentId: z.uuid() }) },
          },
        },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/documents`, (t) =>
            svc.addDocument(t, req.params.id, req.body),
          ),
      );
      app.post(
        '/guests/documents/:id/reveal',
        { schema: { tags, params: idParams, body: revealInput, response: { 200: revealedDocument } } },
        async (req, reply) => {
          reply.header('Cache-Control', 'no-store');
          return tx(req, (t) => svc.revealDocument(t, req.params.id, req.body.reason));
        },
      );
      app.delete(
        '/guests/documents/:id',
        { schema: { tags, params: idParams, body: reasonBody, response: { 204: z.null() } } },
        async (req, reply) => {
          await tx(req, (t) => svc.deleteDocument(t, req.params.id, req.body.reason));
          return reply.status(204).send(null);
        },
      );
      app.post(
        '/guests/profiles/:id/special-needs',
        {
          schema: {
            tags,
            params: idParams,
            body: specialNeedInput,
            response: { 201: z.object({ specialNeedId: z.uuid(), alertId: z.uuid().nullable() }) },
          },
        },
        (req, reply) =>
          idem(req, reply, `POST /guests/profiles/${req.params.id}/special-needs`, (t) =>
            svc.addSpecialNeed(t, req.params.id, req.body),
          ),
      );
      app.post(
        '/guests/special-needs/:id/reveal',
        {
          schema: {
            tags,
            params: idParams,
            body: revealInput,
            response: { 200: z.object({ id: z.uuid(), category: z.string(), detail: z.string() }) },
          },
        },
        async (req, reply) => {
          reply.header('Cache-Control', 'no-store');
          return tx(req, (t) => svc.readSpecialNeed(t, req.params.id, req.body.reason));
        },
      );
      app.post(
        '/guests/profiles/:id/legal-hold',
        { schema: { tags, params: idParams, body: legalHoldInput, response: { 200: guestProfile } } },
        (req) => tx(req, (t) => svc.setLegalHold(t, req.params.id, req.body)),
      );

      // ───────────── Search ─────────────
      app.get(
        '/guests/search',
        { schema: { tags, querystring: searchQuery, response: { 200: searchResult } } },
        (req) => tx(req, (t) => svc.searchProfiles(t, req.query)),
      );

      // ───────────── Duplicates, merge, unmerge ─────────────
      app.get(
        '/guests/duplicates',
        {
          schema: {
            tags,
            querystring: z.object({
              status: z.enum(['open', 'merged', 'dismissed']).default('open'),
              propertyId: z.uuid().optional(),
              limit: z.coerce.number().int().min(1).max(200).default(50),
            }),
            response: { 200: z.object({ items: z.array(duplicateCandidateView) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            svc.listDuplicates(t, {
              status: req.query.status,
              limit: req.query.limit,
              ...(req.query.propertyId ? { propertyId: req.query.propertyId } : {}),
            }),
          ),
        }),
      );
      app.post(
        '/guests/duplicates/:id/dismiss',
        { schema: { tags, params: idParams, body: dismissInput, response: { 200: duplicateCandidateView } } },
        (req) => tx(req, (t) => svc.dismissDuplicate(t, req.params.id, req.body.reason)),
      );
      app.post(
        '/guests/merges/preview',
        { schema: { tags, body: mergeInput.omit({ reason: true }), response: { 200: mergePreview } } },
        (req) =>
          tx(req, (t) =>
            svc.previewMerge(t, {
              survivorId: req.body.survivorId,
              mergedId: req.body.mergedId,
              ...(req.body.fieldChoices ? { fieldChoices: req.body.fieldChoices } : {}),
            }),
          ),
      );
      app.post(
        '/guests/merges',
        { schema: { tags, body: mergeInput, response: { 201: mergeView } } },
        (req, reply) =>
          idem(req, reply, 'POST /guests/merges', async (t) => {
            const { mergeId } = await svc.mergeProfiles(t, {
              survivorId: req.body.survivorId,
              mergedId: req.body.mergedId,
              reason: req.body.reason,
              ...(req.body.fieldChoices ? { fieldChoices: req.body.fieldChoices } : {}),
            });
            return svc.getMerge(t, mergeId);
          }),
      );
      app.get(
        '/guests/merges/:id',
        { schema: { tags, params: idParams, response: { 200: mergeView } } },
        (req) => tx(req, (t) => svc.getMerge(t, req.params.id)),
      );
      app.get(
        '/guests/profiles/:id/merges',
        { schema: { tags, params: idParams, response: { 200: z.object({ items: z.array(mergeView) }) } } },
        async (req) => ({ items: await tx(req, (t) => svc.listMergesForProfile(t, req.params.id)) }),
      );
      app.get(
        '/guests/merges/:id/unmerge-preview',
        { schema: { tags, params: idParams, response: { 200: unmergePreview } } },
        (req) => tx(req, (t) => svc.previewUnmerge(t, req.params.id)),
      );
      app.post(
        '/guests/merges/:id/unmerge',
        { schema: { tags, params: idParams, body: unmergeInput, response: { 200: mergeView } } },
        (req, reply) =>
          idem(
            req,
            reply,
            `POST /guests/merges/${req.params.id}/unmerge`,
            async (t) => {
              await svc.unmergeProfiles(t, {
                mergeId: req.params.id,
                reason: req.body.reason,
                ...(req.body.assignments ? { assignments: req.body.assignments } : {}),
              });
              return svc.getMerge(t, req.params.id);
            },
            200,
          ),
      );

      // ───────────── Companies & agencies ─────────────
      app.post(
        '/guests/companies',
        { schema: { tags, body: companyInput, response: { 201: companyView } } },
        async (req, reply) =>
          withEtag(
            reply,
            await idem(req, reply, 'POST /guests/companies', (t) => svc.createCompany(t, req.body)),
          ),
      );
      app.get(
        '/guests/companies',
        {
          schema: {
            tags,
            querystring: z.object({
              q: z.string().max(200).optional(),
              kind: companyKind.optional(),
              status: companyStatus.optional(),
              limit: z.coerce.number().int().min(1).max(200).default(50),
            }),
            response: { 200: z.object({ items: z.array(companyView) }) },
          },
        },
        async (req) => ({
          items: await tx(req, (t) =>
            svc.listCompanies(t, {
              limit: req.query.limit,
              ...(req.query.q ? { q: req.query.q } : {}),
              ...(req.query.kind ? { kind: req.query.kind } : {}),
              ...(req.query.status ? { status: req.query.status } : {}),
            }),
          ),
        }),
      );
      app.get(
        '/guests/companies/:id',
        { schema: { tags, params: idParams, response: { 200: companyView } } },
        async (req, reply) => withEtag(reply, await tx(req, (t) => svc.getCompany(t, req.params.id))),
      );
      app.patch(
        '/guests/companies/:id',
        { schema: { tags, params: idParams, body: companyUpdate, response: { 200: companyView } } },
        async (req, reply) => {
          const expected = requireIfMatch(req);
          return withEtag(
            reply,
            await tx(req, (t) => svc.updateCompany(t, req.params.id, expected, req.body)),
          );
        },
      );
      app.post(
        '/guests/companies/:id/contacts',
        { schema: { tags, params: idParams, body: companyContactInput, response: { 201: companyView } } },
        (req, reply) =>
          idem(req, reply, `POST /guests/companies/${req.params.id}/contacts`, (t) =>
            svc.addCompanyContact(t, req.params.id, req.body),
          ),
      );
      app.delete(
        '/guests/company-contacts/:id',
        { schema: { tags, params: idParams, response: { 200: companyView } } },
        (req) => tx(req, (t) => svc.removeCompanyContact(t, req.params.id)),
      );

      // ───────────── Privacy (data-subject requests) ─────────────
      app.post(
        '/guests/privacy-requests',
        {
          schema: {
            tags,
            body: privacyRequestInput,
            response: { 201: privacyRequestView },
          },
        },
        // The stored idempotent response is the request record only — never the exported personal data.
        (req, reply) =>
          idem(req, reply, 'POST /guests/privacy-requests', (t) => svc.submitPrivacyRequest(t, req.body)),
      );
      app.get(
        '/guests/privacy-requests/:id/export',
        { schema: { tags, params: idParams } },
        async (req, reply) => {
          reply.header('Cache-Control', 'no-store');
          reply.header('Content-Disposition', `attachment; filename="guest-export-${req.params.id}.json"`);
          return tx(req, (t) => svc.downloadExport(t, req.params.id));
        },
      );
      app.get(
        '/guests/privacy-requests/:id',
        { schema: { tags, params: idParams, response: { 200: privacyRequestView } } },
        (req) => tx(req, (t) => svc.getPrivacyRequest(t, req.params.id)),
      );
    },
  };
}
