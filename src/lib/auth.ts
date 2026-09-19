// Tiny password lock. Password is set on first launch and stored as
// SHA-256 hash in the browser (localStorage) — NOT in the repo.
// Note: frontend-only lock, isko soft gate samjho (devtools wala bypass kar sakta hai).
const KEY = 'saw-lock-v1';

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isSetup(): boolean {
  return !!localStorage.getItem(KEY);
}

export async function setupPassword(id: string, password: string): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify({ id, hash: await sha256(id + '::' + password) }));
  sessionStorage.setItem('saw-session', '1');
}

export async function verifyLogin(id: string, password: string): Promise<boolean> {
  const raw = localStorage.getItem(KEY);
  if (!raw) return false;
  const saved = JSON.parse(raw);
  const ok = saved.id === id && saved.hash === (await sha256(id + '::' + password));
  if (ok) sessionStorage.setItem('saw-session', '1');
  return ok;
}

export function isLoggedIn(): boolean {
  return sessionStorage.getItem('saw-session') === '1';
}

export function logout(): void {
  sessionStorage.removeItem('saw-session');
}
