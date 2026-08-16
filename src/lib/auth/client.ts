'use client';

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
}

interface AuthErrorDetail {
  path: string;
  message: string;
}

/**
 * Client-side wrapper around /api/auth.
 *
 * Returns the server's message rather than a generic string so validation
 * feedback (for example the minimum password length) reaches the user.
 */
export async function submitAuth(params: {
  action: 'login' | 'register';
  email: string;
  password: string;
  name?: string;
}): Promise<AuthedUser> {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
    // Ensures the Set-Cookie from the session is stored.
    credentials: 'same-origin',
  });

  const payload = (await response.json().catch(() => ({}))) as {
    user?: AuthedUser;
    error?: string;
    details?: AuthErrorDetail[];
  };

  if (!response.ok) {
    const detail = payload.details?.[0];
    throw new Error(
      detail ? `${detail.path}: ${detail.message}` : (payload.error ?? 'Request failed.'),
    );
  }

  if (!payload.user) throw new Error('Unexpected response from the server.');

  return payload.user;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'logout' }),
    credentials: 'same-origin',
  });
}
