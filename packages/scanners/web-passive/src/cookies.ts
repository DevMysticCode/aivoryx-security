import type {
  HttpCookieObservation,
  HttpObservation,
  PassiveCheck,
  PassiveCheckContext,
  ReportFindingInput,
} from '@aivoryx/scanner-core';

// Heuristic only — used to decide whether Secure/HttpOnly gaps warrant an
// elevated severity, never to prove a cookie actually carries a session.
// See Part E: "Do not assume every cookie is sensitive."
const SENSITIVE_NAME_PATTERN = /(session|auth|token|jwt|sid|login|remember)/i;

function evidenceFor(cookie: HttpCookieObservation): Record<string, unknown> {
  return {
    // Deliberately NOT named "cookie"/"cookieName" — the worker's generic
    // evidence redaction treats any key CONTAINING "cookie" as secret-shaped
    // (a precaution against ever leaking a raw Set-Cookie header) and would
    // blank this out even though it only ever holds the cookie's NAME.
    name: cookie.name,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    domain: cookie.domain,
    path: cookie.path,
  };
}

function checkCookie(
  cookie: HttpCookieObservation,
  observation: HttpObservation,
  ctx: PassiveCheckContext,
): ReportFindingInput[] {
  const findings: ReportFindingInput[] = [];
  const sensitive = SENSITIVE_NAME_PATTERN.test(cookie.name);

  // The Secure flag is only meaningful to demand on an HTTPS-served
  // response — a purely HTTP deployment can't set a cookie that only
  // travels over HTTPS without breaking the site, so flagging it there
  // would be noise rather than an actionable finding.
  if (observation.scheme === 'https' && !cookie.secure) {
    findings.push({
      title: `Cookie "${cookie.name}" is missing the Secure flag`,
      description: `Cookie "${cookie.name}" was set over HTTPS without the Secure attribute, so it could also be sent over an unencrypted HTTP connection.`,
      severity: sensitive ? 'MEDIUM' : 'LOW',
      confidence: 'HIGH',
      category: 'cookies',
      key: `cookie:${cookie.name}:missing-secure`,
      target: ctx.target,
      evidence: evidenceFor(cookie),
      remediation: `Set the Secure attribute on the "${cookie.name}" cookie.`,
      references: [
        'https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies',
      ],
    });
  }

  if (!cookie.httpOnly) {
    findings.push({
      title: `Cookie "${cookie.name}" is missing the HttpOnly flag`,
      description: `Cookie "${cookie.name}" does not have HttpOnly set, so it is readable by JavaScript running on the page (e.g. via an XSS bug).`,
      severity: sensitive ? 'MEDIUM' : 'LOW',
      confidence: 'HIGH',
      category: 'cookies',
      key: `cookie:${cookie.name}:missing-httponly`,
      target: ctx.target,
      evidence: evidenceFor(cookie),
      remediation: `Set the HttpOnly attribute on the "${cookie.name}" cookie.`,
      references: [
        'https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#restrict_access_to_cookies',
      ],
    });
  }

  if (cookie.sameSite === 'None' && !cookie.secure) {
    // Deterministic and unambiguous: modern browsers reject SameSite=None
    // without Secure outright, so this is a concrete misconfiguration, not
    // a judgment call.
    findings.push({
      title: `Cookie "${cookie.name}" uses SameSite=None without Secure`,
      description: `Cookie "${cookie.name}" is set with SameSite=None but without Secure. Browsers require Secure alongside SameSite=None, so this cookie may be rejected or behave unpredictably.`,
      severity: 'MEDIUM',
      confidence: 'HIGH',
      category: 'cookies',
      key: `cookie:${cookie.name}:samesite-none-without-secure`,
      target: ctx.target,
      evidence: evidenceFor(cookie),
      remediation: `Add Secure to the "${cookie.name}" cookie, or use a stricter SameSite value.`,
      references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite'],
    });
  } else if (cookie.sameSite === null) {
    findings.push({
      title: `Cookie "${cookie.name}" does not set SameSite`,
      description: `Cookie "${cookie.name}" does not explicitly set SameSite. Browsers default to Lax, but an explicit value removes reliance on that default.`,
      severity: 'INFO',
      confidence: 'HIGH',
      category: 'cookies',
      key: `cookie:${cookie.name}:missing-samesite`,
      target: ctx.target,
      evidence: evidenceFor(cookie),
      remediation: `Explicitly set SameSite (Lax or Strict) on the "${cookie.name}" cookie.`,
      references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie/SameSite'],
    });
  }

  return findings;
}

export const cookieSecurityCheck: PassiveCheck<HttpObservation> = {
  name: 'cookie-security',
  category: 'cookies',
  run(observation, context) {
    return observation.cookies.flatMap((cookie) => checkCookie(cookie, observation, context));
  },
};
