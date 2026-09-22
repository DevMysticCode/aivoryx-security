export class AuthenticationError extends Error {
  readonly statusCode = 401;

  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  readonly statusCode = 403;

  constructor(message = 'Not authorized') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/** Thrown specifically when a principal's organization does not match the
 * resource's organization — the tenant-isolation boundary. Kept as a distinct
 * subclass so tests and logs can distinguish it from a plain permission denial. */
export class TenantAccessError extends AuthorizationError {
  constructor(message = 'This resource does not belong to your organization') {
    super(message);
    this.name = 'TenantAccessError';
  }
}
