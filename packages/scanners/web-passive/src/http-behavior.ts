import type { HttpObservation, PassiveCheck, ReportFindingInput } from '@aivoryx/scanner-core';

export const httpBehaviorCheck: PassiveCheck<HttpObservation> = {
  name: 'http-behavior',
  category: 'http-behavior',
  run(observation, ctx) {
    const findings: ReportFindingInput[] = [];

    if (observation.status >= 500) {
      findings.push({
        title: `Target returned a server error (HTTP ${observation.status})`,
        description: `The reachability request received HTTP ${observation.status}, indicating the target may be experiencing an error condition.`,
        severity: 'INFO',
        confidence: 'HIGH',
        category: 'http-behavior',
        key: 'http-5xx-response',
        target: ctx.target,
        evidence: { status: observation.status },
      });
    }

    if (observation.status === 200 && !observation.contentType) {
      findings.push({
        title: 'Successful response has no Content-Type header',
        description:
          'The response returned HTTP 200 without a Content-Type header, which can lead to inconsistent ' +
          'browser interpretation of the response body.',
        severity: 'LOW',
        confidence: 'HIGH',
        category: 'http-behavior',
        key: 'missing-content-type',
        target: ctx.target,
        remediation: 'Set an explicit, accurate Content-Type header on all responses.',
      });
    }

    return findings;
  },
};
