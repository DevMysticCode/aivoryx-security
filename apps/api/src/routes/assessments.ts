import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ASSESSMENT_TYPES, DISCOVERY_METHODS, URL_TYPES } from '@aivoryx/shared-types';
import type { AssessmentsService } from '../services/assessments.js';
import { requireAnyIdentity, identityFromRequest } from '../auth/context.js';
import { badRequest, notFound, requestContext } from '../http.js';

export interface AssessmentRouteDependencies {
  assessmentsService: AssessmentsService;
}

const createAssessmentBodySchema = z.object({
  assetId: z.string().uuid(),
  assessmentType: z.enum(ASSESSMENT_TYPES),
  assetBuildId: z.string().uuid().optional(),
});

const listDiscoveredUrlsQuerySchema = z.object({
  urlType: z.enum(URL_TYPES).optional(),
  discoveryMethod: z.enum(DISCOVERY_METHODS).optional(),
  statusCode: z.coerce.number().int().optional(),
  contentType: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export function registerAssessmentRoutes(
  app: FastifyInstance,
  deps: AssessmentRouteDependencies,
): void {
  const { assessmentsService } = deps;

  app.get('/api/v1/projects/:projectId/assessments', async (request, reply) => {
    requireAnyIdentity(request);
    const { projectId } = request.params as { projectId: string };

    const assessments = await assessmentsService.list(identityFromRequest(request), projectId);
    if (assessments === null) return notFound(reply, request.id);
    return { assessments };
  });

  app.post('/api/v1/projects/:projectId/assessments', async (request, reply) => {
    requireAnyIdentity(request);
    const { projectId } = request.params as { projectId: string };
    const parsed = createAssessmentBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const assessment = await assessmentsService.create(
      identityFromRequest(request),
      projectId,
      parsed.data,
      requestContext(request),
    );
    if (assessment === null) return notFound(reply, request.id);
    reply.status(201);
    return { assessment };
  });

  app.get('/api/v1/assessments/:assessmentId', async (request, reply) => {
    requireAnyIdentity(request);
    const { assessmentId } = request.params as { assessmentId: string };

    const assessment = await assessmentsService.getById(identityFromRequest(request), assessmentId);
    if (!assessment) return notFound(reply, request.id);
    return { assessment };
  });

  app.get('/api/v1/assessments/:assessmentId/findings', async (request, reply) => {
    requireAnyIdentity(request);
    const { assessmentId } = request.params as { assessmentId: string };

    const findings = await assessmentsService.listFindings(
      identityFromRequest(request),
      assessmentId,
    );
    if (findings === null) return notFound(reply, request.id);
    return { findings };
  });

  app.get('/api/v1/assessments/:assessmentId/discovered-urls', async (request, reply) => {
    requireAnyIdentity(request);
    const { assessmentId } = request.params as { assessmentId: string };
    const parsed = listDiscoveredUrlsQuerySchema.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const result = await assessmentsService.listDiscoveredUrls(
      identityFromRequest(request),
      assessmentId,
      parsed.data,
    );
    if (result === null) return notFound(reply, request.id);
    return {
      discoveredUrls: result.items,
      pagination: { total: result.total, limit: result.limit, offset: result.offset },
    };
  });

  app.get('/api/v1/findings/:findingId', async (request, reply) => {
    requireAnyIdentity(request);
    const { findingId } = request.params as { findingId: string };

    const result = await assessmentsService.getFindingById(identityFromRequest(request), findingId);
    if (!result) return notFound(reply, request.id);
    return result;
  });

  app.post('/api/v1/assessments/:assessmentId/cancel', async (request, reply) => {
    requireAnyIdentity(request);
    const { assessmentId } = request.params as { assessmentId: string };

    const assessment = await assessmentsService.cancel(
      identityFromRequest(request),
      assessmentId,
      requestContext(request),
    );
    if (!assessment) return notFound(reply, request.id);
    return { assessment };
  });
}
