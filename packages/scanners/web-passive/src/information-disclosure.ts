import type { HttpObservation, PassiveCheck, ReportFindingInput } from '@aivoryx/scanner-core';

// Header name -> human-readable label. Purely deterministic: a finding is
// only ever created for a header that is literally present in the response.
const DISCLOSURE_HEADERS: Record<string, string> = {
  server: 'Server',
  'x-powered-by': 'X-Powered-By',
  'x-aspnet-version': 'X-AspNet-Version',
  'x-aspnetmvc-version': 'X-AspNetMvc-Version',
  'x-generator': 'X-Generator',
};

export const informationDisclosureCheck: PassiveCheck<HttpObservation> = {
  name: 'information-disclosure',
  category: 'information-disclosure',
  run(observation, ctx) {
    const findings: ReportFindingInput[] = [];

    for (const [headerName, label] of Object.entries(DISCLOSURE_HEADERS)) {
      const value = observation.headers[headerName];
      if (!value) continue;

      findings.push({
        title: `${label} header discloses technology information`,
        description: `The response includes a ${label} header with value "${value}". This is purely informational — technology disclosure alone is not a vulnerability, but it can help an attacker prioritize known issues for the disclosed version.`,
        severity: 'INFO',
        confidence: 'HIGH',
        category: 'information-disclosure',
        key: `disclosure:${headerName}`,
        target: ctx.target,
        evidence: { header: label, value },
        remediation: `Consider removing or genericizing the ${label} header if it is not needed.`,
      });
    }

    return findings;
  },
};
