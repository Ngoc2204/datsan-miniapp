const configuredApiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
export const API_URL = configuredApiUrl.endsWith('/') ? configuredApiUrl.slice(0, -1) : configuredApiUrl;
const ACCESS_TOKEN_KEY = 'datsan.accessToken';

function readStoredToken(): string | null {
  try { return window.sessionStorage.getItem(ACCESS_TOKEN_KEY); }
  catch { return null; }
}

let accessToken: string | null = readStoredToken();

export function getAccessToken() { return accessToken; }

export function setAccessToken(token: string | null) {
  accessToken = token;
  try {
    if (token) window.sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    else window.sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch { /* Keep the current tab session in memory when storage is unavailable. */ }
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', 'Bearer ' + accessToken);
  let response: Response;
  try { response = await fetch(API_URL + path, { ...options, headers }); }
  catch { throw new Error('Không kết nối được API. Kiểm tra API đang chạy và VITE_API_URL trong apps/web/.env.'); }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(payload?.message) ? payload.message.join(', ') : payload?.message;
    throw new Error(message || 'Yêu cầu không thành công. Vui lòng thử lại.');
  }
  return payload as T;
}

export function jsonBody(value: unknown): string { return JSON.stringify(value); }

export {
  isZaloMiniApp,
  initZaloHeader,
  getZaloLocation,
  getZaloAccessToken,
  getZaloUserInfo,
} from './zalo';

import { getZaloPhoneNumber as fetchZaloPhoneNumber } from './zalo';

export async function getZaloPhone(): Promise<string> {
  return fetchZaloPhoneNumber(api, accessToken || undefined);
}

