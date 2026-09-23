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
import { Select } from '../../components/ui/Select';
import { ColorField } from '../../components/ui/ColorField';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { THEME_PRESETS, type Organization, type ThemePreset } from '../../types/api';

export function ThemeSection({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [form, setForm] = useState({
    themePreset: (organization.themePreset as ThemePreset) || 'aivoryx',
    primaryColor: organization.primaryColor ?? '',
    secondaryColor: organization.secondaryColor ?? '',
    accentColor: organization.accentColor ?? '',
  });

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<{ organization: Organization }>(
        `/api/v1/organizations/${organization.id}/settings/theme`,
        {
          themePreset: form.themePreset,
          primaryColor: form.primaryColor || null,
          secondaryColor: form.secondaryColor || null,
          accentColor: form.accentColor || null,
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      showToast({ title: 'Theme updated — brand colors apply immediately', tone: 'success' });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>
          Sets your organization&apos;s brand colors across the workspace. This is separate from
          each teammate&apos;s own light/dark appearance choice.
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
          <FormField label="Preset" htmlFor="themePreset">
            <Select
              id="themePreset"
              value={form.themePreset}
              onChange={(e) =>
                setForm((f) => ({ ...f, themePreset: e.target.value as ThemePreset }))
              }
            >
              {THEME_PRESETS.map((preset) => (
                <option key={preset} value={preset}>
                  {preset}
                </option>
              ))}
            </Select>
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ColorField
              label="Primary"
              value={form.primaryColor}
              onChange={(value) => setForm((f) => ({ ...f, primaryColor: value }))}
            />
            <ColorField
              label="Secondary"
              value={form.secondaryColor}
              onChange={(value) => setForm((f) => ({ ...f, secondaryColor: value }))}
            />
            <ColorField
              label="Accent"
              value={form.accentColor}
              onChange={(value) => setForm((f) => ({ ...f, accentColor: value }))}
            />
          </div>
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
              Save theme
            </Button>
          </PermissionGate>
        </form>
      </CardContent>
    </Card>
  );
}
