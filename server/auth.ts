import crypto from 'crypto';
import { db } from './data';
import { dbEnabled, q } from './db';

declare global {
  namespace Express {
    interface Request {
      admin?: (typeof db.administrators)[number];
    }
  }
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Used when no DATABASE_URL is set; production sessions live in the admin_sessions table. */
const memorySessions = new Map<string, { adminId: number; expiresAt: number }>();

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored?: string | null): boolean {
  if (!stored || !password) return false;
  const [scheme, salt, key] = stored.split(':');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(key, 'hex');
  const b = Buffer.from(candidate, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * The captured API samples carry no password hashes, so a fresh database has no way to log in.
 * ADMIN_BOOTSTRAP_PASSWORD is hashed onto every OWNER account that still lacks a password at boot;
 * without it the panel refuses rather than accepting any password the way the mock did.
 */
export async function bootstrapAdminPassword(): Promise<string[]> {
  const wanted = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
  if (!wanted) return [];
  const targets = db.administrators.filter((a) => (a.role || 'OWNER') === 'OWNER' && !a.passwordHash && a.active !== false);
  if (!targets.length) return [];
  const hash = hashPassword(wanted);
  for (const target of targets) {
    target.passwordHash = hash;
    if (dbEnabled()) {
      await q(
        `insert into administrators (id, email, full_name, role, active, password_hash)
         values ($1,$2,$3,$4,$5,$6) on conflict (id) do update set password_hash=excluded.password_hash`,
        [target.id, target.email, target.fullName, target.role || 'OWNER', target.active ?? true, hash],
      );
    }
  }
  return targets.map((t) => t.email);
}

export async function createSession(adminId: number): Promise<string> {
  const token = `adm_${crypto.randomBytes(24).toString('hex')}`;
  const expiresAt = Date.now() + SESSION_TTL_MS;
  if (dbEnabled()) {
    await q('delete from admin_sessions where expires_at < now()');
    await q('insert into admin_sessions (token, admin_id, expires_at) values ($1, $2, to_timestamp($3 / 1000.0))', [token, adminId, expiresAt]);
  } else {
    memorySessions.set(token, { adminId, expiresAt });
  }
  return token;
}

export async function resolveSession(token: string): Promise<number | null> {
  if (!token) return null;
  if (dbEnabled()) {
    const r = await q('select admin_id, expires_at from admin_sessions where token = $1', [token]);
    if (!r.rowCount) return null;
    if (new Date(r.rows[0].expires_at).getTime() < Date.now()) {
      await q('delete from admin_sessions where token = $1', [token]);
      return null;
    }
    return Number(r.rows[0].admin_id);
  }
  const hit = memorySessions.get(token);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    memorySessions.delete(token);
    return null;
  }
  return hit.adminId;
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  if (dbEnabled()) await q('delete from admin_sessions where token = $1', [token]);
  else memorySessions.delete(token);
}

export const bearerToken = (req: { headers: Record<string, unknown> }): string => {
  const header = (req.headers?.authorization ?? req.headers?.Authorization ?? '') as string;
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
};

/** Credential-less admin endpoints. Everything else under /admin/ needs a live session. */
const PUBLIC_ADMIN_PATHS = new Set(['/admin/auth/login', '/admin/auth/dev-login']);

export function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/');
}

export function isPublicAdminPath(path: string): boolean {
  return PUBLIC_ADMIN_PATHS.has(path);
}

/** POST /admin/auth/dev-login hands out a session without a password; off unless explicitly asked for. */
export function devLoginAllowed(): boolean {
  return process.env.ADMIN_DEV_LOGIN === 'true' && process.env.NODE_ENV !== 'production';
}
