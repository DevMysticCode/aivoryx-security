import type { FastifyInstance } from 'fastify';
import type { PlatformService } from '../services/platform.js';
import { requireAnyIdentity, identityFromRequest } from '../auth/context.js';

export interface PlatformRouteDependencies {
  platformService: PlatformService;
}

/** Platform Super Admin routes (Part 6/7) — distinct from every tenant-scoped route; requirePlatformPermission inside the service is what actually gates access, not the URL prefix alone. */
export function registerPlatformRoutes(
  app: FastifyInstance,
  deps: PlatformRouteDependencies,
): void {
  const { platformService } = deps;

  app.get('/api/v1/platform/stats', async (request) => {
    requireAnyIdentity(request);
    const stats = await platformService.getStats(identityFromRequest(request));
    return { stats };
  });

  app.get('/api/v1/platform/organizations/recent', async (request) => {
    requireAnyIdentity(request);
    const organizations = await platformService.listRecentOrganizations(
      identityFromRequest(request),
    );
    return { organizations };
  });
}
