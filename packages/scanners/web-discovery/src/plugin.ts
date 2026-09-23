import type { ScannerContext, ScannerPlugin } from '@aivoryx/scanner-core';
import type { WebAssetConfig } from '@aivoryx/shared-types';
import { runWebDiscovery } from './crawler.js';

const SCANNER_NAME = 'web-discovery';

function primaryTargetUrl(context: ScannerContext): string {
  const config = context.asset.config as Partial<WebAssetConfig>;
  if (!config.baseUrl) {
    throw new Error(`Asset ${context.asset.id} has no baseUrl configured`);
  }
  return config.baseUrl;
}

/**
 * Batch 6's WEB scanner: supersedes the Batch 4 http-reachability scanner
 * for WEB/WEB assessments (still exported standalone from
 * @aivoryx/scanner-http-reachability, and still independently testable) so
 * the seed URL is fetched exactly once — reachability finding, passive
 * analysis, AND discovery all come from that single request, then the
 * crawl continues to further in-scope pages. See Part 18/23.
 */
export const webDiscoveryScanner: ScannerPlugin = {
  name: SCANNER_NAME,
  supportedAssetTypes: ['WEB'],
  supportedAssessmentTypes: ['WEB'],
  requiredCapabilities: ['http-egress'],

  async run(context: ScannerContext): Promise<void> {
    const target = primaryTargetUrl(context);
    if (!context.reportDiscoveredUrl) {
      throw new Error('web-discovery requires a worker that supports reportDiscoveredUrl');
    }

    context.logger.info({ target }, 'web-discovery: starting crawl');

    const result = await runWebDiscovery(target, {
      httpClient: context.httpClient,
      scope: context.scope,
      assetType: context.asset.assetType,
      logger: context.logger,
      reportFinding: context.reportFinding,
      reportDiscoveredUrl: context.reportDiscoveredUrl,
    });

    context.logger.info(
      { target, requestCount: result.requestCount, limitsHit: result.limitsHit },
      'web-discovery: crawl finished',
    );
  },
};

export const SCANNER_REGISTRY = [webDiscoveryScanner];
