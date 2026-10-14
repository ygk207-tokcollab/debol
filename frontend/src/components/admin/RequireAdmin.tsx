import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAdminAuth } from '../../state/AdminAuth';

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isSignedIn, restoring, session } = useAdminAuth();
  const location = useLocation();

  // Bouncing to the login page while /admin/auth/me is still in flight would drop the deep link.
  if (restoring) {
    return <p className="py-16 text-center text-sm text-ink-mute">{'Checking your session…'}</p>;
  }
  if (!isSignedIn) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />;
  }
  // The server owns the permission list; the client only hides what the role cannot use.
  if (session && session.permissions.length === 0) {
    return (
      <div className="container max-w-lg py-16">
        <div className="card px-6 py-8 text-center">
          <h1 className="font-display text-xl text-ink">This account has no panel permissions</h1>
          <p className="mt-2 text-sm text-ink-soft">
            Ask an owner to grant the role you need, then sign in again.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
