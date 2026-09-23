import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState } from '../../components/ui/ErrorState';
import { Card, CardContent } from '../../components/ui/Card';
import { SeverityBadge } from '../../components/ui/SeverityBadge';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { Evidence, Finding } from '../../types/api';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard access can be denied — the evidence stays visible either way
        }
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function FindingDetailPage() {
  const { findingId } = useParams<{ findingId: string }>();

  const query = useQuery({
    queryKey: ['finding', findingId],
    queryFn: () =>
      apiClient.get<{ finding: Finding; evidence: Evidence[] }>(`/api/v1/findings/${findingId}`),
    enabled: Boolean(findingId),
  });

  if (query.isLoading) return <LoadingState label="Loading finding…" />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return null;

  const { finding, evidence } = query.data;

  return (
    <PageContainer>
      <PageHeader
        title={finding.title}
        description={`${finding.scanner} · ${finding.category}`}
        actions={
          <div className="flex items-center gap-2">
            <SeverityBadge severity={finding.severity} />
            <Badge tone="neutral">{finding.confidence} confidence</Badge>
            <Badge tone="neutral">{finding.status}</Badge>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Description</p>
            <p className="mt-1 text-sm text-muted-foreground">{finding.description}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Target</p>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {finding.target}
            </p>
          </div>
          {finding.remediation && (
            <div>
              <p className="text-sm font-medium text-foreground">Remediation</p>
              <p className="mt-1 text-sm text-muted-foreground">{finding.remediation}</p>
            </div>
          )}
          {finding.references.length > 0 && (
            <div>
              <p className="text-sm font-medium text-foreground">References</p>
              <ul className="mt-1 flex flex-col gap-1">
                {finding.references.map((reference) => (
                  <li key={reference}>
                    <a
                      href={reference}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm text-primary hover:underline"
                    >
                      {reference}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {evidence.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">Evidence</p>
          {evidence.map((item) => {
            const text = JSON.stringify(item.data, null, 2);
            return (
              <Card key={item.id}>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    <CopyButton text={text} />
                  </div>
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs text-foreground">
                    {text}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
