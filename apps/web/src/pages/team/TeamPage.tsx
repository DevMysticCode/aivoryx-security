import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client';
import { useOrganization } from '../../organization/OrganizationContext';
import { PageContainer } from '../../components/layout/PageContainer';
import { PageHeader } from '../../components/layout/PageHeader';
import { LoadingState } from '../../components/ui/LoadingState';
import { ErrorState, errorMessage } from '../../components/ui/ErrorState';
import { EmptyState } from '../../components/ui/EmptyState';
import { DataTable } from '../../components/ui/DataTable';
import { RoleBadge } from '../../components/ui/RoleBadge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { FormField } from '../../components/ui/FormField';
import { TextInput } from '../../components/ui/TextInput';
import { Select } from '../../components/ui/Select';
import { Alert } from '../../components/ui/Alert';
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog';
import { PermissionGate } from '../../components/ui/PermissionGate';
import { ORGANIZATION_ROLES, type Member, type OrganizationRole } from '../../types/api';

export function TeamPage() {
  const { currentOrganization } = useOrganization();
  const organizationId = currentOrganization?.id;
  const queryClient = useQueryClient();
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrganizationRole>('VIEWER');
  const [pendingRemoval, setPendingRemoval] = useState<Member | null>(null);

  const query = useQuery({
    queryKey: ['members', organizationId],
    queryFn: () =>
      apiClient.get<{ members: Member[] }>(`/api/v1/organizations/${organizationId}/members`),
    enabled: Boolean(organizationId),
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ member: Member }>(`/api/v1/organizations/${organizationId}/members`, {
        email,
        role,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', organizationId] });
      setIsInviteOpen(false);
      setEmail('');
      setRole('VIEWER');
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ memberId, newRole }: { memberId: string; newRole: OrganizationRole }) =>
      apiClient.patch<{ member: Member }>(
        `/api/v1/organizations/${organizationId}/members/${memberId}`,
        { role: newRole },
      ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members', organizationId] }),
  });

  const removeMutation = useMutation({
    mutationFn: (memberId: string) =>
      apiClient.delete(`/api/v1/organizations/${organizationId}/members/${memberId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['members', organizationId] });
      setPendingRemoval(null);
    },
  });

  return (
    <PageContainer>
      <PageHeader
        title="Team"
        description="Manage who has access to this organization."
        actions={
          <PermissionGate permission="member:invite">
            <Button onClick={() => setIsInviteOpen(true)}>Invite member</Button>
          </PermissionGate>
        }
      />

      {query.isLoading ? (
        <LoadingState label="Loading team…" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data || query.data.members.length === 0 ? (
        <EmptyState
          title="No members"
          description="Invite teammates to collaborate on assessments."
        />
      ) : (
        <DataTable
          rows={query.data.members}
          rowKey={(member) => member.id}
          columns={[
            {
              header: 'Member',
              render: (member) => <span className="font-mono text-xs">{member.userId}</span>,
            },
            {
              header: 'Role',
              render: (member) => (
                <PermissionGate
                  permission="member:update"
                  fallback={<RoleBadge role={member.role} />}
                >
                  <Select
                    aria-label="Role"
                    value={member.role}
                    onChange={(event) =>
                      roleMutation.mutate({
                        memberId: member.id,
                        newRole: event.target.value as OrganizationRole,
                      })
                    }
                    className="h-8 text-xs"
                  >
                    {ORGANIZATION_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </Select>
                </PermissionGate>
              ),
            },
            { header: 'Status', render: (member) => member.status },
            {
              header: '',
              render: (member) => (
                <PermissionGate permission="member:remove">
                  <Button variant="ghost" size="sm" onClick={() => setPendingRemoval(member)}>
                    Remove
                  </Button>
                </PermissionGate>
              ),
            },
          ]}
        />
      )}

      <Modal open={isInviteOpen} onClose={() => setIsInviteOpen(false)} title="Invite member">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            inviteMutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <FormField label="Email" htmlFor="invite-email">
            <TextInput
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </FormField>
          <FormField label="Role" htmlFor="invite-role">
            <Select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as OrganizationRole)}
            >
              {ORGANIZATION_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </FormField>
          {inviteMutation.isError && (
            <Alert tone="destructive">{errorMessage(inviteMutation.error)}</Alert>
          )}
          <Button type="submit" isLoading={inviteMutation.isPending}>
            Send invite
          </Button>
        </form>
      </Modal>

      <ConfirmationDialog
        open={pendingRemoval !== null}
        title="Remove member?"
        description="They will immediately lose access to this organization."
        confirmLabel="Remove"
        isDestructive
        isLoading={removeMutation.isPending}
        onConfirm={() => pendingRemoval && removeMutation.mutate(pendingRemoval.id)}
        onCancel={() => setPendingRemoval(null)}
      />
    </PageContainer>
  );
}
