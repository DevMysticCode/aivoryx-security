import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background text-center">
      <p className="text-2xl font-semibold text-foreground">Page not found</p>
      <p className="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
      <Link to="/" className="text-sm font-medium text-primary hover:underline">
        Go home
      </Link>
    </div>
  );
}
