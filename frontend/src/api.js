export const API_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

// Authenticated fetch helper — attaches the JWT and parses JSON / errors.
export async function apiFetch(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}
