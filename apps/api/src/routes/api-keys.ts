import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ApiKeysService } from '../services/api-keys.js';
import { requireAnyIdentity, identityFromRequest } from '../auth/context.js';
import { badRequest, notFound, requestContext } from '../http.js';

export interface ApiKeyRouteDependencies {
  apiKeysService: ApiKeysService;
}

const organizationIdQuerySchema = z.object({ organizationId: z.string().uuid() });

const createApiKeyBodySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  expiresAt: z.string().datetime().optional(),
});

export function registerApiKeyRoutes(app: FastifyInstance, deps: ApiKeyRouteDependencies): void {
  const { apiKeysService } = deps;

  app.get('/api/v1/api-keys', async (request, reply) => {
    requireAnyIdentity(request);
    const parsed = organizationIdQuerySchema.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const apiKeys = await apiKeysService.list(
      identityFromRequest(request),
      parsed.data.organizationId,
    );
    return { apiKeys };
  });

  app.post('/api/v1/api-keys', async (request, reply) => {
    requireAnyIdentity(request);
    const parsed = createApiKeyBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const created = await apiKeysService.create(
      identityFromRequest(request),
      parsed.data.organizationId,
      {
        name: parsed.data.name,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
      },
      requestContext(request),
    );
    reply.status(201);
    // rawKey is present exactly once, in this response, and nowhere else.
    return { apiKey: created };
  });

  app.delete('/api/v1/api-keys/:apiKeyId', async (request, reply) => {
    requireAnyIdentity(request);
    const { apiKeyId } = request.params as { apiKeyId: string };

    const revoked = await apiKeysService.revoke(
      identityFromRequest(request),
      apiKeyId,
      requestContext(request),
    );
    if (!revoked) return notFound(reply, request.id);
    return { apiKey: revoked };
  });
}
