import type { HttpObservation, PassiveCheck, PassiveCheckContext } from '@aivoryx/scanner-core';
import type { ReportFindingInput } from '@aivoryx/scanner-core';

function checkCsp(observation: HttpObservation, ctx: PassiveCheckContext): ReportFindingInput[] {
  const csp = observation.headers['content-security-policy'];
  if (!csp) {
    return [
      {
        title: 'No Content-Security-Policy header',
        description:
          'The response did not include a Content-Security-Policy header. CSP is a defense-in-depth ' +
          'control against content-injection attacks such as XSS; its absence does not by itself prove ' +
          'the site is exploitable, but there is no browser-enforced restriction on injected scripts/styles.',
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'csp-missing',
        target: ctx.target,
        remediation:
          'Add a Content-Security-Policy header restricting script/style/object sources to trusted origins.',
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
      },
    ];
  }

  // Deliberately NOT a full CSP parser/evaluator (Part D) — only flag the
  // narrow, unambiguous case of an inline/eval-execution directive value
  // literally present in the header, which is directly provable from the
  // header text alone.
  const lower = csp.toLowerCase();
  if (lower.includes("'unsafe-inline'") || lower.includes("'unsafe-eval'")) {
    return [
      {
        title: 'Content-Security-Policy allows unsafe script execution',
        description:
          "The Content-Security-Policy header includes 'unsafe-inline' and/or 'unsafe-eval', which " +
          'permits inline scripts or eval-based execution and substantially weakens CSP as an XSS defense.',
        severity: 'MEDIUM',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'csp-unsafe-directive',
        target: ctx.target,
        evidence: { header: 'Content-Security-Policy', value: csp },
        remediation:
          "Remove 'unsafe-inline'/'unsafe-eval' from the policy; use nonces/hashes for required inline scripts.",
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP'],
      },
    ];
  }

  return [];
}

function checkHsts(observation: HttpObservation, ctx: PassiveCheckContext): ReportFindingInput[] {
  // HSTS is only meaningful on an HTTPS response — an HTTP response cannot
  // carry a trustworthy HSTS instruction. See Part D.
  if (observation.scheme !== 'https') return [];

  const hsts = observation.headers['strict-transport-security'];
  if (!hsts) {
    return [
      {
        title: 'No Strict-Transport-Security header on HTTPS response',
        description:
          'The HTTPS response did not include Strict-Transport-Security. Without HSTS, browsers may ' +
          'still allow a downgrade to plain HTTP on a future visit (e.g. via an attacker-controlled network).',
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'hsts-missing',
        target: ctx.target,
        remediation: 'Add Strict-Transport-Security: max-age=31536000; includeSubDomains.',
        references: [
          'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
        ],
      },
    ];
  }

  const match = /max-age\s*=\s*(\d+)/i.exec(hsts);
  const maxAge = match?.[1] ? Number(match[1]) : null;
  // 300s is an unambiguous, deliberately conservative floor — well below any
  // reasonable production value, so flagging it can't be a false positive.
  if (maxAge !== null && maxAge < 300) {
    return [
      {
        title: 'Strict-Transport-Security max-age is very low',
        description: `The HSTS max-age is ${maxAge} seconds, which is too short to provide meaningful protection.`,
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'hsts-weak-max-age',
        target: ctx.target,
        evidence: { header: 'Strict-Transport-Security', value: hsts },
        remediation: 'Set max-age to at least 31536000 (one year) for production use.',
        references: [
          'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
        ],
      },
    ];
  }

  return [];
}

function checkXContentTypeOptions(
  observation: HttpObservation,
  ctx: PassiveCheckContext,
): ReportFindingInput[] {
  const value = observation.headers['x-content-type-options'];
  if (!value) {
    return [
      {
        title: 'No X-Content-Type-Options header',
        description:
          'The response did not include X-Content-Type-Options: nosniff, so browsers may MIME-sniff ' +
          'the response body away from the declared Content-Type in some circumstances.',
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'xcto-missing',
        target: ctx.target,
        remediation: 'Add X-Content-Type-Options: nosniff.',
        references: [
          'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options',
        ],
      },
    ];
  }

  // Accept any casing/whitespace variant of the one valid value — avoid
  // penalizing a technically-correct header for cosmetic formatting.
  if (value.trim().toLowerCase() !== 'nosniff') {
    return [
      {
        title: 'X-Content-Type-Options has an unrecognized value',
        description: `X-Content-Type-Options was present but set to "${value}" rather than "nosniff", so it has no effect.`,
        severity: 'INFO',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'xcto-invalid-value',
        target: ctx.target,
        evidence: { header: 'X-Content-Type-Options', value },
        remediation: 'Set X-Content-Type-Options to exactly "nosniff".',
      },
    ];
  }

  return [];
}

function checkReferrerPolicy(
  observation: HttpObservation,
  ctx: PassiveCheckContext,
): ReportFindingInput[] {
  const value = observation.headers['referrer-policy'];
  if (!value) {
    return [
      {
        title: 'No Referrer-Policy header',
        description:
          'The response did not include a Referrer-Policy header. Modern browsers default to a ' +
          'reasonably safe policy, but an explicit policy removes reliance on that default.',
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'referrer-policy-missing',
        target: ctx.target,
        remediation: 'Add Referrer-Policy: strict-origin-when-cross-origin (or a stricter policy).',
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy'],
      },
    ];
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'unsafe-url') {
    return [
      {
        title: 'Referrer-Policy is set to unsafe-url',
        description:
          'Referrer-Policy: unsafe-url sends the full referrer URL (including path and query string) ' +
          'on every cross-origin request, which can leak sensitive URL data to third-party origins.',
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'security-headers',
        key: 'referrer-policy-weak',
        target: ctx.target,
        evidence: { header: 'Referrer-Policy', value },
        remediation: 'Use a stricter policy such as strict-origin-when-cross-origin.',
        references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy'],
      },
    ];
  }

  return [];
}

function checkPermissionsPolicy(
  observation: HttpObservation,
  ctx: PassiveCheckContext,
): ReportFindingInput[] {
  if (observation.headers['permissions-policy']) return [];
  return [
    {
      title: 'No Permissions-Policy header',
      description:
        'The response did not include a Permissions-Policy header. This is an informational observation — ' +
        'a missing Permissions-Policy is not, by itself, a vulnerability.',
      severity: 'INFO',
      confidence: 'HIGH',
      category: 'security-headers',
      key: 'permissions-policy-missing',
      target: ctx.target,
      remediation:
        'Consider adding a Permissions-Policy header to explicitly restrict powerful browser features (camera, microphone, geolocation, etc).',
      references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy'],
    },
  ];
}

function checkFramingProtection(
  observation: HttpObservation,
  ctx: PassiveCheckContext,
): ReportFindingInput[] {
  const xfo = observation.headers['x-frame-options']?.trim().toUpperCase();
  const hasXfo = xfo === 'DENY' || xfo === 'SAMEORIGIN';

  const csp = observation.headers['content-security-policy'];
  const hasFrameAncestors = csp ? csp.toLowerCase().includes('frame-ancestors') : false;

  // Either mechanism provides the relevant protection — only flag when
  // NEITHER is present, and never report two separate findings for the same
  // underlying gap. See Part D.
  if (hasXfo || hasFrameAncestors) return [];

  return [
    {
      title: 'No clickjacking protection (X-Frame-Options or CSP frame-ancestors)',
      description:
        'The response did not include X-Frame-Options (DENY/SAMEORIGIN) or a CSP frame-ancestors ' +
        'directive, so the page could potentially be embedded in a frame on another site.',
      severity: 'MEDIUM',
      confidence: 'HIGH',
      category: 'security-headers',
      key: 'framing-protection-missing',
      target: ctx.target,
      remediation:
        'Add X-Frame-Options: DENY (or SAMEORIGIN), or a Content-Security-Policy frame-ancestors directive.',
      references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options'],
    },
  ];
}

export const securityHeadersCheck: PassiveCheck<HttpObservation> = {
  name: 'security-headers',
  category: 'security-headers',
  run(observation, context) {
    return [
      ...checkCsp(observation, context),
      ...checkHsts(observation, context),
      ...checkXContentTypeOptions(observation, context),
      ...checkReferrerPolicy(observation, context),
      ...checkPermissionsPolicy(observation, context),
      ...checkFramingProtection(observation, context),
    ];
  },
};
