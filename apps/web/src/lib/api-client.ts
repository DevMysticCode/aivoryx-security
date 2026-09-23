// Thin, typed fetch wrapper around the Aivoryx API. Every request sends
// `credentials: 'include'` so the httpOnly session cookie is attached — the
// frontend never reads or stores the session token itself (see
// docs/authorization.md's cookie-based auth model). There is deliberately no
// automatic redirect-on-401 here: a 401 from `/me` just means "not signed
// in" (handled by SessionContext), while a 401 from any other call is a
// genuine error the caller should surface — centralizing a redirect here
// risks a redirect loop on the login page itself.

const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly issues: unknown;

  constructor(status: number, message: string, requestId?: string, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.requestId = requestId;
    this.issues = issues;
  }
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload = isJson ? await response.json() : undefined;

  if (!response.ok) {
    const message =
      (payload as { error?: { message?: string } } | undefined)?.error?.message ??
      `Request failed with status ${response.status}`;
    const requestId = (payload as { error?: { requestId?: string } } | undefined)?.error?.requestId;
    const issues = (payload as { error?: { issues?: unknown } } | undefined)?.error?.issues;
    throw new ApiError(response.status, message, requestId, issues);
  }

  return payload as T;
}

export const apiClient = {
  get: <T>(path: string, query?: RequestOptions['query']) =>
    request<T>(path, { method: 'GET', query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
