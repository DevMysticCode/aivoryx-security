import type { HttpObservation, PassiveCheck, ReportFindingInput } from '@aivoryx/scanner-core';

/**
 * Passive CORS analysis only — this batch never sends an attacker-controlled
 * Origin header and never proves exploitability, only that a given response
 * header combination was observed. See Part F.
 */
export const corsCheck: PassiveCheck<HttpObservation> = {
  name: 'cors',
  category: 'cors',
  run(observation, ctx) {
    const acao = observation.headers['access-control-allow-origin'];
    if (!acao) return [];

    const acac = observation.headers['access-control-allow-credentials']?.trim().toLowerCase();
    const findings: ReportFindingInput[] = [];

    if (acao.trim() === '*') {
      if (acac === 'true') {
        // Per the CORS spec, `Access-Control-Allow-Origin: *` combined with
        // `Access-Control-Allow-Credentials: true` is an invalid combination
        // that compliant browsers reject — but a server sending it anyway is
        // a real, directly-observed misconfiguration worth surfacing, even
        // though passive analysis alone can't prove a browser will honor it.
        findings.push({
          title: 'CORS wildcard origin combined with credentials',
          description:
            'The response sent Access-Control-Allow-Origin: * together with ' +
            'Access-Control-Allow-Credentials: true. This combination is invalid per the CORS spec and ' +
            'compliant browsers will reject it, but it indicates a CORS configuration that likely intended ' +
            'to allow credentialed cross-origin requests from any origin.',
          severity: 'MEDIUM',
          confidence: 'MEDIUM',
          category: 'cors',
          key: 'cors-wildcard-with-credentials',
          target: ctx.target,
          evidence: {
            'access-control-allow-origin': acao,
            'access-control-allow-credentials':
              observation.headers['access-control-allow-credentials'],
          },
          remediation:
            'Reflect a specific, validated Origin instead of "*" when Access-Control-Allow-Credentials is true.',
          references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'],
        });
      } else {
        findings.push({
          title: 'CORS allows any origin (Access-Control-Allow-Origin: *)',
          description:
            'The response allows cross-origin requests from any origin. This is common and often intentional ' +
            'for public, unauthenticated APIs — it is only a concern if the endpoint also relies on ' +
            'cookie/credential-based authentication.',
          severity: 'LOW',
          confidence: 'HIGH',
          category: 'cors',
          key: 'cors-wildcard-origin',
          target: ctx.target,
          evidence: { 'access-control-allow-origin': acao },
          remediation:
            'Confirm this endpoint is intended to be public. If it relies on cookies/credentials, restrict Access-Control-Allow-Origin to specific trusted origins.',
          references: ['https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS'],
        });
      }
    }

    return findings;
  },
};
