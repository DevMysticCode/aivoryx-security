import { useOrganization } from '../../organization/OrganizationContext';
import { Select } from '../ui/Select';

export function OrganizationSwitcher() {
  const { organizations, currentOrganization, switchOrganization } = useOrganization();

  if (organizations.length <= 1) {
    return (
      <span className="text-sm font-semibold text-foreground">
        {currentOrganization?.displayName || currentOrganization?.name || 'Aivoryx Security'}
      </span>
    );
  }

  return (
    <Select
      aria-label="Organization"
      value={currentOrganization?.id ?? ''}
      onChange={(event) => switchOrganization(event.target.value)}
      className="h-8 font-medium"
    >
      {organizations.map((org) => (
        <option key={org.id} value={org.id}>
          {org.displayName || org.name}
        </option>
      ))}
    </Select>
  );
}
