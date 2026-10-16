import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { TextField } from '../../components/form';
import { useAdminAuth } from '../../state/AdminAuth';
import { loginSchema, fieldErrors } from '../../lib/validation';

interface LoginForm {
  identifier: string;
  password: string;
}

export default function AdminLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isSignedIn, restoring, signIn, busy, error } = useAdminAuth();

  const [values, setValues] = useState<LoginForm>({ identifier: '', password: '' });
  const [errors, setErrors] = useState<Record<string, { message: string }>>({});

  // A stored token may still be valid: rendering the form (or redirecting) before /me answers
  // would throw away the page the operator was on.
  if (restoring) return <p className="py-16 text-center text-sm text-ink-mute">{'Checking your session…'}</p>;

  // Already signed in: the login screen is only ever a redirect away from the dashboard.
  if (isSignedIn) return <Navigate to="/admin/dashboard" replace />;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ email: values.identifier, password: values.password });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    // signIn never logs the password; on success the token is stored, on failure the server's
    // message is surfaced (401 = bad credentials, 429 = rate limit / lockout).
    void signIn(values.identifier, values.password).then((ok) => {
      if (ok) navigate('/admin/dashboard', { replace: true });
    });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="card px-6 py-7">
          <div className="mb-5 flex items-center gap-2 text-primary-600">
            <ShieldCheck className="size-5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="eyebrow">{'Store administration'}</p>
              <h1 className="font-display text-xl leading-tight text-ink">{t('admin.loginTitle')}</h1>
            </div>
          </div>
          <p className="mb-5 text-sm text-ink-soft">{t('admin.loginHelp')}</p>

          {/* ApiError propagates the server message verbatim; this covers 401 and 429 lockout. */}
          {error && (
            <p
              role="alert"
              className="mb-4 rounded-md border border-error-300/60 bg-error-100 px-3 py-2 text-sm text-error-600"
            >
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <TextField
              label={'Email or administrator identifier'}
              name="identifier"
              type="text"
              inputMode="email"
              autoComplete="username"
              required
              value={values.identifier}
              error={errors.email?.message}
              onChange={(e) => setValues((v) => ({ ...v, identifier: e.target.value }))}
            />
            <TextField
              label={t('admin.password')}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={values.password}
              error={errors.password?.message}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            />
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? t('admin.loading') : t('admin.signIn')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
