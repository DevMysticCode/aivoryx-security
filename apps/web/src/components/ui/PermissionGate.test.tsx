import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionGate } from './PermissionGate';

const useOrganizationMock = vi.fn();

vi.mock('../../organization/OrganizationContext', () => ({
  useOrganization: () => useOrganizationMock(),
}));

describe('PermissionGate', () => {
  it('renders children when the current role has the permission', () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: { myRole: 'OWNER' } });
    render(
      <PermissionGate permission="organization:update">
        <button>Edit</button>
      </PermissionGate>,
    );
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('renders the fallback when the current role lacks the permission', () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: { myRole: 'VIEWER' } });
    render(
      <PermissionGate permission="organization:update" fallback={<span>Read only</span>}>
        <button>Edit</button>
      </PermissionGate>,
    );
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
  });

  it('renders nothing when there is no current organization', () => {
    useOrganizationMock.mockReturnValue({ currentOrganization: null });
    const { container } = render(
      <PermissionGate permission="organization:update">
        <button>Edit</button>
      </PermissionGate>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
