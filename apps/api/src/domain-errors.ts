/**
 * A business-rule violation that isn't an authentication/authorization failure
 * (those are packages/auth's AuthenticationError/AuthorizationError/
 * TenantAccessError) — e.g. an invalid asset/assessment-type combination, an
 * asset whose authorization isn't confirmed yet, or an invalid status
 * transition. Picked up by the same global error handler (reads
 * `error.statusCode`/`error.message`) as every other typed error in this API.
 */
export class DomainError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'DomainError';
    this.statusCode = statusCode;
  }
}
