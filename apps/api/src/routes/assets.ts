import type { FastifyInstance } from 'fastify';
import type { AssetsService } from '../services/assets.js';
import { requireAnyIdentity, identityFromRequest } from '../auth/context.js';
import { badRequest, notFound, requestContext } from '../http.js';
import { createAssetBodySchema, updateAssetBodySchema } from '../validation/assets.js';

export interface AssetRouteDependencies {
  assetsService: AssetsService;
}

export function registerAssetRoutes(app: FastifyInstance, deps: AssetRouteDependencies): void {
  const { assetsService } = deps;

  app.get('/api/v1/projects/:projectId/assets', async (request, reply) => {
    requireAnyIdentity(request);
    const { projectId } = request.params as { projectId: string };

    const assets = await assetsService.list(identityFromRequest(request), projectId);
    if (assets === null) return notFound(reply, request.id);
    return { assets };
  });

  app.post('/api/v1/projects/:projectId/assets', async (request, reply) => {
    requireAnyIdentity(request);
    const { projectId } = request.params as { projectId: string };
    const parsed = createAssetBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const asset = await assetsService.create(
      identityFromRequest(request),
      projectId,
      parsed.data,
      requestContext(request),
    );
    if (asset === null) return notFound(reply, request.id);
    reply.status(201);
    return { asset };
  });

  app.get('/api/v1/assets/:assetId', async (request, reply) => {
    requireAnyIdentity(request);
    const { assetId } = request.params as { assetId: string };

    const asset = await assetsService.getById(identityFromRequest(request), assetId);
    if (!asset) return notFound(reply, request.id);
    return { asset };
  });

  app.patch('/api/v1/assets/:assetId', async (request, reply) => {
    requireAnyIdentity(request);
    const { assetId } = request.params as { assetId: string };
    const parsed = updateAssetBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const asset = await assetsService.update(
      identityFromRequest(request),
      assetId,
      parsed.data,
      requestContext(request),
    );
    if (!asset) return notFound(reply, request.id);
    return { asset };
  });
}
