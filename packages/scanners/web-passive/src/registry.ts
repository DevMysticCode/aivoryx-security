import {
  createPassiveCheckRegistry,
  type HttpObservation,
  type PassiveCheck,
} from '@aivoryx/scanner-core';
import { securityHeadersCheck } from './security-headers.js';
import { cookieSecurityCheck } from './cookies.js';
import { corsCheck } from './cors.js';
import { informationDisclosureCheck } from './information-disclosure.js';
import { transportCheck } from './transport.js';
import { httpBehaviorCheck } from './http-behavior.js';

/**
 * WEB_PASSIVE (Part S): the passive-check profile for a WEB reachability
 * observation. Built-in checks only — API clients can never select or
 * supply their own check implementation (Part R).
 */
export const WEB_PASSIVE_CHECKS: readonly PassiveCheck<HttpObservation>[] =
  createPassiveCheckRegistry([
    securityHeadersCheck,
    cookieSecurityCheck,
    corsCheck,
    informationDisclosureCheck,
    transportCheck,
    httpBehaviorCheck,
  ]);
