import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { errorMessage } from '../../components/ui/ErrorState';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { TextInput } from '../../components/ui/TextInput';
import { Alert } from '../../components/ui/Alert';
import type { Organization } from '../../types/api';

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function CreateOrganizationForm() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ organization: Organization }>('/api/v1/organizations', { name, slug }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5"
    >
      <FormField label="Organization name" htmlFor="org-name">
        <TextInput
          id="org-name"
          value={name}
          required
          onChange={(event) => {
            setName(event.target.value);
            if (!slugTouched) setSlug(slugify(event.target.value));
          }}
        />
      </FormField>
      <FormField
        label="URL slug"
        htmlFor="org-slug"
        hint="Lowercase letters, numbers, and hyphens only"
      >
        <TextInput
          id="org-slug"
          value={slug}
          required
          pattern="[a-z0-9][a-z0-9-]*"
          onChange={(event) => {
            setSlugTouched(true);
            setSlug(event.target.value);
          }}
        />
      </FormField>
      {mutation.isError && <Alert tone="destructive">{errorMessage(mutation.error)}</Alert>}
      <Button type="submit" isLoading={mutation.isPending}>
        Create organization
      </Button>
    </form>
  );
}
