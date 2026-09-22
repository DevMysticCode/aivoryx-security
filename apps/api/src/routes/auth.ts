import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '@aivoryx/auth';
import type { AuthService } from '../services/auth.js';
import { requireAnyIdentity } from '../auth/context.js';
import { badRequest, requestContext } from '../http.js';

export interface AuthRouteDependencies {
  authService: AuthService;
  isProduction: boolean;
}

const registerBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
  name: z.string().trim().min(1).max(200).optional(),
});

const loginBodySchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
});

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDependencies): void {
  const cookieOptions = {
    httpOnly: true,
    secure: deps.isProduction,
    // SameSite=Lax is the primary CSRF mitigation for this cookie — see
    // docs/authorization.md's security review for why this is sufficient here
    // without a separate CSRF token.
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };

  app.post(
    '/api/v1/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = registerBodySchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

      const { user, sessionToken } = await deps.authService.register(
        parsed.data,
        requestContext(request),
      );
      reply.setCookie(SESSION_COOKIE_NAME, sessionToken, cookieOptions);
      reply.status(201);
      return { user };
    },
  );

  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const parsed = loginBodySchema.safeParse(request.body);
      if (!parsed.success) return badRequest(reply, request.id, parsed.error.issues);

      const { user, sessionToken } = await deps.authService.login(
        parsed.data,
        requestContext(request),
      );
      reply.setCookie(SESSION_COOKIE_NAME, sessionToken, cookieOptions);
      return { user };
    },
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const rawToken = request.cookies[SESSION_COOKIE_NAME];
    if (request.userId && rawToken) {
      await deps.authService.logout(request.userId, rawToken, requestContext(request));
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.status(204);
  });

  app.get('/api/v1/me', async (request) => {
    requireAnyIdentity(request);

    if (request.userId) {
      const user = await deps.authService.getCurrentUser(request.userId);
      return { user, principal: null };
    }

    // API-key authentication: reflects the authenticated principal, not a
    // human user profile — see docs/authorization.md.
    return { user: null, principal: request.principal };
  });
}
