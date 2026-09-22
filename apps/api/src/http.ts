import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { RequestContext } from './services/organizations.js';

export interface ErrorEnvelope {
  error: {
    message: string;
    statusCode: number;
    requestId: string;
  };
}

export function errorEnvelope(
  statusCode: number,
  message: string,
  requestId: string,
): ErrorEnvelope {
  return { error: { message, statusCode, requestId } };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}

export function requestContext(request: FastifyRequest): RequestContext {
  return { ipAddress: request.ip, userAgent: request.headers['user-agent'] };
}

export function badRequest(reply: FastifyReply, requestId: string, issues: z.ZodIssue[]) {
  const message = issues.map((issue) => issue.message).join('; ');
  return reply.status(400).send(errorEnvelope(400, message || 'Invalid request body', requestId));
}

export function notFound(reply: FastifyReply, requestId: string) {
  return reply.status(404).send(errorEnvelope(404, 'Not found', requestId));
}
