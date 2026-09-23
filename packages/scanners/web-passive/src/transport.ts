import type { HttpObservation, PassiveCheck, ReportFindingInput } from '@aivoryx/scanner-core';

export const transportCheck: PassiveCheck<HttpObservation> = {
  name: 'transport',
  category: 'transport',
  run(observation, ctx) {
    const findings: ReportFindingInput[] = [];

    let requestedScheme: string;
    try {
      requestedScheme = new URL(observation.requestedUrl).protocol;
    } catch {
      return findings;
    }

    if (requestedScheme === 'https:' && observation.scheme === 'http') {
      // Directly observed: the assessment started on HTTPS and the final
      // response was served over HTTP — a real downgrade, not an inference.
      findings.push({
        title: 'HTTPS target redirected to HTTP',
        description:
          `The assessment target (${observation.requestedUrl}) redirected to a plain HTTP URL ` +
          `(${observation.finalUrl}), downgrading the connection from encrypted to unencrypted.`,
        severity: 'MEDIUM',
        confidence: 'HIGH',
        category: 'transport',
        key: 'https-downgrade-redirect',
        target: ctx.target,
        evidence: { requestedUrl: observation.requestedUrl, finalUrl: observation.finalUrl },
        remediation:
          'Ensure all redirects from the HTTPS target stay on HTTPS; never redirect to plain HTTP.',
        references: [
          'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security',
        ],
      });
    } else if (requestedScheme === 'http:') {
      findings.push({
        title: 'Assessment target is not served over HTTPS',
        description: `The configured target (${observation.requestedUrl}) uses plain HTTP rather than HTTPS.`,
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'transport',
        key: 'http-target',
        target: ctx.target,
        evidence: { requestedUrl: observation.requestedUrl },
        remediation:
          'Serve the site over HTTPS and redirect HTTP requests to the HTTPS equivalent.',
      });
    }

    return findings;
  },
};
