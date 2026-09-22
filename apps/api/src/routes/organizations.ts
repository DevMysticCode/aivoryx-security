import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ORGANIZATION_ROLES } from '@aivoryx/auth';
import type { OrganizationsService } from '../services/organizations.js';
import type { MembersService } from '../services/members.js';
import { requireAnyIdentity, identityFromRequest } from '../auth/context.js';
import { badRequest, isUniqueViolation, notFound, requestContext, errorEnvelope } from '../http.js';

export interface OrganizationRouteDependencies {
  organizationsService: OrganizationsService;
  membersService: MembersService;
}

const createOrganizationBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric with optional hyphens'),
});

const addMemberBodySchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(ORGANIZATION_ROLES),
});

const updateMemberBodySchema = z.object({
  role: z.enum(ORGANIZATION_ROLES),
});

export function registerOrganizationRoutes(
  app: FastifyInstance,
  deps: OrganizationRouteDependencies,
): void {
  const { organizationsService, membersService } = deps;

  app.get('/api/v1/organizations', async (request) => {
    requireAnyIdentity(request);
    const organizations = await organizationsService.listVisibleTo(identityFromRequest(request));
    return { organizations };
  });

  app.post(
    '/api/v1/organizations',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      requireAnyIdentity(request);
      const parsed = createOrganizationBodySchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

      try {
        const organization = await organizationsService.create(
          identityFromRequest(request),
          parsed.data,
          requestContext(request),
        );
        reply.status(201);
        return { organization };
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply
            .status(409)
            .send(errorEnvelope(409, 'An organization with this slug already exists', request.id));
        }
        throw error;
      }
    },
  );

  app.get('/api/v1/organizations/:organizationId', async (request, reply) => {
    requireAnyIdentity(request);
    const { organizationId } = request.params as { organizationId: string };

    const organization = await organizationsService.getById(
      identityFromRequest(request),
      organizationId,
    );
    if (!organization) return notFound(reply, request.id);
    return { organization };
  });

  app.get('/api/v1/organizations/:organizationId/members', async (request) => {
    requireAnyIdentity(request);
    const { organizationId } = request.params as { organizationId: string };
    const members = await membersService.list(identityFromRequest(request), organizationId);
    return { members };
  });

  app.post('/api/v1/organizations/:organizationId/members', async (request, reply) => {
    requireAnyIdentity(request);
    const { organizationId } = request.params as { organizationId: string };
    const parsed = addMemberBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const member = await membersService.add(
      identityFromRequest(request),
      organizationId,
      parsed.data,
      requestContext(request),
    );
    reply.status(201);
    return { member };
  });

  app.patch('/api/v1/organizations/:organizationId/members/:memberId', async (request, reply) => {
    requireAnyIdentity(request);
    const { organizationId, memberId } = request.params as {
      organizationId: string;
      memberId: string;
    };
    const parsed = updateMemberBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const member = await membersService.updateRole(
      identityFromRequest(request),
      organizationId,
      memberId,
      parsed.data.role,
      requestContext(request),
    );
    if (!member) return notFound(reply, request.id);
    return { member };
  });

  app.delete('/api/v1/organizations/:organizationId/members/:memberId', async (request, reply) => {
    requireAnyIdentity(request);
    const { organizationId, memberId } = request.params as {
      organizationId: string;
      memberId: string;
    };

    const removed = await membersService.remove(
      identityFromRequest(request),
      organizationId,
      memberId,
      requestContext(request),
    );
    if (!removed) return notFound(reply, request.id);
    reply.status(204);
  });
}
