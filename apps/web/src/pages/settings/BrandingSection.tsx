import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { useToast } from '../../components/ui/Toast';
import { errorMessage } from '../../components/ui/ErrorState';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '../../components/ui/Card';
import { FormField } from '../../components/ui/FormField';
import { TextInput } from '../../components/ui/TextInput';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { PermissionGate } from '../../components/ui/PermissionGate';
import type { Organization } from '../../types/api';

export function BrandingSection({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    logoUrl: organization.logoUrl ?? '',
    darkLogoUrl: organization.darkLogoUrl ?? '',
    faviconUrl: organization.faviconUrl ?? '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<{ organization: Organization }>(
        `/api/v1/organizations/${organization.id}/settings/branding`,
        {
          logoUrl: form.logoUrl || null,
          darkLogoUrl: form.darkLogoUrl || null,
          faviconUrl: form.faviconUrl || null,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      showToast({ title: 'Branding updated', tone: 'success' });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
        <CardDescription>
          Logo references only (hosted images) — there is no file upload yet, so paste a direct
          https:// link to each image.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <FormField label="Logo URL" htmlFor="logoUrl" hint="https://…">
            <TextInput
              id="logoUrl"
              type="url"
              value={form.logoUrl}
              onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
            />
          </FormField>
          <FormField label="Dark-mode logo URL" htmlFor="darkLogoUrl" hint="https://…">
            <TextInput
              id="darkLogoUrl"
              type="url"
              value={form.darkLogoUrl}
              onChange={(e) => setForm((f) => ({ ...f, darkLogoUrl: e.target.value }))}
            />
          </FormField>
          <FormField label="Favicon URL" htmlFor="faviconUrl" hint="https://…">
            <TextInput
              id="faviconUrl"
              type="url"
              value={form.faviconUrl}
              onChange={(e) => setForm((f) => ({ ...f, faviconUrl: e.target.value }))}
            />
          </FormField>
          {form.logoUrl && (
            <div className="rounded-md border border-border bg-muted p-4">
              <img src={form.logoUrl} alt="Logo preview" className="h-10 object-contain" />
            </div>
          )}
          {mutation.isError && <Alert tone="destructive">{errorMessage(mutation.error)}</Alert>}
          <PermissionGate
            permission="organization:update"
            fallback={
              <p className="text-sm text-muted-foreground">
                You don&apos;t have permission to edit this.
              </p>
            }
          >
            <Button type="submit" isLoading={mutation.isPending}>
              Save branding
            </Button>
          </PermissionGate>
        </form>
      </CardContent>
    </Card>
  );
}
