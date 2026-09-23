import type { DiscoveryMethod, UrlType } from '@aivoryx/shared-types';

/** One item in the crawler's BFS queue — enough information to track provenance without recursive call stacks (Part 13). */
export interface QueueItem {
  url: string;
  type: UrlType;
  discoveryMethod: DiscoveryMethod;
  depth: number;
  sourceUrl: string | null;
}

export interface DiscoveredFormInput {
  name: string;
  type: string;
}

export interface DiscoveredForm {
  actionUrl: string;
  method: string;
  sourceUrl: string;
  inputs: DiscoveredFormInput[];
  textareas: string[];
  selects: string[];
}

export interface HtmlExtractionResult {
  /** Navigational URLs: <a>, <area>, <link>, <iframe>, <frame>. */
  navigational: string[];
  /** Embedded/resource URLs: <script>, <img>, <source>, <video>, <audio>, <object>. Recorded, never crawled recursively. */
  resources: string[];
  forms: DiscoveredForm[];
}

/** Explicit, conservative crawl limits (Part 11) — a malicious application must never be able to cause an effectively unlimited crawl. */
export interface CrawlLimits {
  /** How many link-hops from the seed to follow. 0 = seed only. */
  maxDepth: number;
  /** Maximum distinct URLs (of any type) recorded as discovered. */
  maxUrls: number;
  /** Maximum outbound HTTP requests the whole crawl may issue (pages + robots.txt + sitemap.xml). */
  maxTotalRequests: number;
  /** Maximum requests in flight at once. */
  maxConcurrentRequests: number;
  /** Maximum new requests started per second. */
  requestsPerSecond: number;
  /** Maximum <loc> URLs read from a single sitemap. */
  maxSitemapUrls: number;
  /** Maximum links extracted from a single page (further links on that page are ignored, not the whole page). */
  maxLinksPerPage: number;
  robotsEnabled: boolean;
  sitemapEnabled: boolean;
}

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = {
  // Conservative defaults (Part 10): depth 2 reaches the seed's links and
  // those pages' links, without approaching an unbounded crawl.
  maxDepth: 2,
  maxUrls: 50,
  maxTotalRequests: 60,
  maxConcurrentRequests: 3,
  requestsPerSecond: 5,
  maxSitemapUrls: 100,
  maxLinksPerPage: 50,
  // Off by default: robots.txt/sitemap.xml discovery is explicitly optional
  // (Part 8/9) and each adds an extra request per assessment. Callers that
  // want it enable it via the limits override passed to runWebDiscovery.
  robotsEnabled: false,
  sitemapEnabled: false,
};

export type DiscoveryEventType =
  | 'URL_DISCOVERED'
  | 'URL_FETCHED'
  | 'URL_SKIPPED_OUT_OF_SCOPE'
  | 'URL_SKIPPED_DUPLICATE'
  | 'URL_SKIPPED_LIMIT'
  | 'REDIRECT_OUT_OF_SCOPE'
  | 'ROBOTS_FETCHED'
  | 'SITEMAP_FETCHED'
  | 'FORM_DISCOVERED';

export interface DiscoveryEvent {
  type: DiscoveryEventType;
  url?: string | undefined;
  detail?: string | undefined;
}

export interface WebDiscoveryResult {
  requestCount: number;
  events: DiscoveryEvent[];
  limitsHit: string[];
}
