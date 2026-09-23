import { useState } from 'react';
import { useSession } from '../../auth/SessionContext';
import { useTheme, type Appearance } from '../../theme/ThemeContext';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';

export function UserMenu() {
  const { user, logout } = useSession();
  const { appearance, setAppearance } = useTheme();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Select
        aria-label="Appearance"
        value={appearance}
        onChange={(event) => setAppearance(event.target.value as Appearance)}
        className="h-8 text-xs"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </Select>
      <div className="text-right">
        <p className="text-sm font-medium leading-none text-foreground">
          {user?.name ?? user?.email}
        </p>
        <p className="text-xs text-muted-foreground">{user?.email}</p>
      </div>
      <Button variant="outline" size="sm" onClick={handleLogout} isLoading={isLoggingOut}>
        Sign out
      </Button>
    </div>
  );
}
