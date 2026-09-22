# @aivoryx/queue

Redis connection and [BullMQ](https://docs.bullmq.io/) queue infrastructure. Defines the three
foundation queues and their typed job data; business processing for each is implemented in a
later batch.

## Queues

| Queue                      | Purpose                                                |
| -------------------------- | ------------------------------------------------------ |
| `assessment-orchestration` | One job per assessment; fans out into per-scanner jobs |
| `assessment-jobs`          | One job per scanner plugin run against one asset       |
| `report-generation`        | One job per report generation request                  |

## Usage

```typescript
import { getConfig } from '@aivoryx/config';
import { createRedisConnection, createAppQueues, QUEUE_NAMES } from '@aivoryx/queue';

const config = getConfig();
const connection = createRedisConnection(config.redis.url);
const queues = createAppQueues(connection);

await queues.assessmentJobs.add('scan', {
  assessmentJobId: '...',
  assessmentId: '...',
  scannerName: 'basic-http-reachability',
});
```

## Tests

```bash
pnpm --filter @aivoryx/queue test               # unit tests, no external services required
```

Integration tests require a live Redis instance:

```bash
pnpm infra:up
TEST_REDIS_URL=redis://localhost:6379 pnpm --filter @aivoryx/queue test:integration
```
