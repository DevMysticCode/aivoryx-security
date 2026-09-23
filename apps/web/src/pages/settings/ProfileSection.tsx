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
import { TextInput, Textarea } from '../../components/ui/TextInput';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { PermissionGate } from '../../components/ui/PermissionGate';
import type { Organization } from '../../types/api';

export function ProfileSection({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    displayName: organization.displayName ?? '',
    website: organization.website ?? '',
    industry: organization.industry ?? '',
    description: organization.description ?? '',
    contactEmail: organization.contactEmail ?? '',
    phone: organization.phone ?? '',
    country: organization.country ?? '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<{ organization: Organization }>(
        `/api/v1/organizations/${organization.id}/settings/profile`,
        form,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      showToast({ title: 'Profile updated', tone: 'success' });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company profile</CardTitle>
        <CardDescription>Shown across your workspace and in future reports.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <FormField label="Display name" htmlFor="displayName">
            <TextInput
              id="displayName"
              value={form.displayName}
              onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
            />
          </FormField>
          <FormField label="Website" htmlFor="website">
            <TextInput
              id="website"
              type="url"
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
            />
          </FormField>
          <FormField label="Industry" htmlFor="industry">
            <TextInput
              id="industry"
              value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
            />
          </FormField>
          <FormField label="Contact email" htmlFor="contactEmail">
            <TextInput
              id="contactEmail"
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            />
          </FormField>
          <FormField label="Phone" htmlFor="phone">
            <TextInput
              id="phone"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </FormField>
          <FormField label="Country" htmlFor="country">
            <TextInput
              id="country"
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Description" htmlFor="description">
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </FormField>
          </div>
          {mutation.isError && (
            <div className="sm:col-span-2">
              <Alert tone="destructive">{errorMessage(mutation.error)}</Alert>
            </div>
          )}
          <div className="sm:col-span-2">
            <PermissionGate
              permission="organization:update"
              fallback={
                <p className="text-sm text-muted-foreground">
                  You don&apos;t have permission to edit this.
                </p>
              }
            >
              <Button type="submit" isLoading={mutation.isPending}>
                Save profile
              </Button>
            </PermissionGate>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
