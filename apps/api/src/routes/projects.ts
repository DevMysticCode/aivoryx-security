import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ProjectsService } from '../services/projects.js';
import { requireAnyIdentity, identityFromRequest } from '../auth/context.js';
import { badRequest, isUniqueViolation, notFound, requestContext, errorEnvelope } from '../http.js';

export interface ProjectRouteDependencies {
  projectsService: ProjectsService;
}

const organizationIdQuerySchema = z.object({ organizationId: z.string().uuid() });

const createProjectBodySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase alphanumeric with optional hyphens'),
  description: z.string().max(2_000).optional(),
});

const updateProjectBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2_000).optional(),
});

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectRouteDependencies): void {
  const { projectsService } = deps;

  app.get('/api/v1/projects', async (request, reply) => {
    requireAnyIdentity(request);
    const parsed = organizationIdQuerySchema.safeParse(request.query);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const projects = await projectsService.list(
      identityFromRequest(request),
      parsed.data.organizationId,
    );
    return { projects };
  });

  app.post('/api/v1/projects', async (request, reply) => {
    requireAnyIdentity(request);
    const parsed = createProjectBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    try {
      const project = await projectsService.create(
        identityFromRequest(request),
        parsed.data.organizationId,
        parsed.data,
        requestContext(request),
      );
      reply.status(201);
      return { project };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply
          .status(409)
          .send(
            errorEnvelope(
              409,
              'A project with this slug already exists in your organization',
              request.id,
            ),
          );
      }
      throw error;
    }
  });

  app.get('/api/v1/projects/:projectId', async (request, reply) => {
    requireAnyIdentity(request);
    const { projectId } = request.params as { projectId: string };

    const project = await projectsService.getById(identityFromRequest(request), projectId);
    if (!project) return notFound(reply, request.id);
    return { project };
  });

  app.patch('/api/v1/projects/:projectId', async (request, reply) => {
    requireAnyIdentity(request);
    const { projectId } = request.params as { projectId: string };
    const parsed = updateProjectBodySchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

    const project = await projectsService.update(
      identityFromRequest(request),
      projectId,
      parsed.data,
      requestContext(request),
    );
    if (!project) return notFound(reply, request.id);
    return { project };
  });

  app.delete('/api/v1/projects/:projectId', async (request, reply) => {
    requireAnyIdentity(request);
    const { projectId } = request.params as { projectId: string };

    const project = await projectsService.archive(
      identityFromRequest(request),
      projectId,
      requestContext(request),
    );
    if (!project) return notFound(reply, request.id);
    return { project };
  });
}
