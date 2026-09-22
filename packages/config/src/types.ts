import type { RawEnv } from './schema.js';

export type NodeEnv = RawEnv['NODE_ENV'];
export type AppEnv = NonNullable<RawEnv['APP_ENV']> | NodeEnv;
export type AIProvider = NonNullable<RawEnv['AI_PROVIDER']>;
export type LogLevel = NonNullable<RawEnv['LOG_LEVEL']>;

export interface AppConfig {
  nodeEnv: NodeEnv;
  appEnv: AppEnv;
  appName: string;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  logLevel: LogLevel;

  api: {
    port: number;
  };

  urls: {
    publicAppUrl: string;
    publicApiUrl: string;
    /** Worker/service -> API URL. Falls back to `urls.publicApiUrl` when unset. */
    internalApiUrl: string;
  };

  database: {
    url: string;
  };

  redis: {
    url: string;
  };

  auth: {
    jwtSecret: string;
    jwtExpiresIn: string;
  };

  security: {
    credentialMasterKey: string;
    ssrfAllowPrivateRanges: boolean;
    allowedScanPorts: number[];
    scanTimeoutMs: number;
    maxResponseBytes: number;
    workerConcurrency: number;
    connectTimeoutMs: number;
    maxRedirects: number;
    maxHeaderBytes: number;
    maxRequestsPerAssessment: number;
  };

  ai: {
    enabled: boolean;
    provider?: AIProvider | undefined;
    model?: string | undefined;
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
  };
}
