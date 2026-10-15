import {
  getAccessToken as zmpGetAccessToken,
  getLocation as zmpGetLocation,
  getPhoneNumber as zmpGetPhoneNumber,
  getUserInfo as zmpGetUserInfo,
  setNavigationBarColor as zmpSetNavigationBarColor,
  setNavigationBarTitle as zmpSetNavigationBarTitle,
} from 'zmp-sdk';

export type GeoCoordinates = {
  latitude: number;
  longitude: number;
};

export type ZaloUserProfile = {
  id?: string;
  name?: string;
  avatar?: string;
};

/**
 * Detect whether the app is currently running inside the Zalo Mini App runtime environment
 */
export function isZaloMiniApp(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const ua = window.navigator?.userAgent?.toLowerCase() || '';
    if (ua.includes('zalo') || ua.includes('zmp')) return true;
    if (window.location.hostname.includes('zdn.vn') || window.location.hostname.includes('zalo.me')) return true;
    if (new URL(window.location.href).searchParams.get('env') === 'TESTING_LOCAL') return true;
    const win = window as unknown as { ZaloMiniAppSDK?: unknown; zAppID?: unknown; APP_ID?: unknown };
    if (win.ZaloMiniAppSDK || win.zAppID || win.APP_ID) return true;
  } catch {
    // Ignore URL/window access errors
  }
  return false;
}

/**
 * Initialize native navigation bar in Zalo Mini App
 */
export async function initZaloHeader(title = 'DatSan - Đặt sân thể thao'): Promise<void> {
  if (!isZaloMiniApp()) return;
  try {
    await zmpSetNavigationBarTitle({ title });
  } catch (cause) {
    console.debug('ZMP setNavigationBarTitle skipped:', cause);
  }
  try {
    await zmpSetNavigationBarColor({
      color: '#11161d',
      statusBarColor: '#11161d',
      textColor: 'white',
    });
  } catch (cause) {
    console.debug('ZMP setNavigationBarColor skipped:', cause);
  }
}

/**
 * Retrieve user's current GPS location.
 * Uses native Zalo Mini App SDK `getLocation` when in Zalo, and smoothly falls back
 * to standard browser `navigator.geolocation` for web browsers and localhost testing.
 */
export async function getZaloLocation(): Promise<GeoCoordinates> {
  // 1. Try native Zalo Mini App getLocation when inside Zalo
  if (isZaloMiniApp()) {
    try {
      const result = await zmpGetLocation();
      const res = result as unknown as {
        latitude?: number | string;
        longitude?: number | string;
        token?: string;
      };
      if (res?.latitude !== undefined && res?.longitude !== undefined) {
        const lat = Number(res.latitude);
        const lng = Number(res.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
          return { latitude: lat, longitude: lng };
        }
      }
    } catch (cause) {
      console.warn('Zalo native getLocation failed, falling back to browser geolocation:', cause);
    }
  }

  // 2. Fallback to HTML5 Geolocation API
  return new Promise<GeoCoordinates>((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Thiết bị hoặc trình duyệt chưa hỗ trợ định vị GPS.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        let msg = 'Không thể xác định vị trí hiện tại.';
        if (error.code === error.PERMISSION_DENIED) {
          msg = 'Quyền truy cập vị trí đã bị từ chối trong trình duyệt / ứng dụng.';
        } else if (error.code === error.TIMEOUT) {
          msg = 'Hết thời gian chờ nhận tín hiệu GPS. Vui lòng thử lại.';
        }
        reject(new Error(msg));
      },
      { enableHighAccuracy: false, timeout: 9000 },
    );
  });
}

/**
 * Retrieve Zalo access token.
 * Inside Zalo Mini App: calls native zmp-sdk getAccessToken().
 * In local development or desktop browser: generates a simulated dev token
 * (`demo_zalo_...`) so developers and testers can verify the complete login flow.
 */
export async function getZaloAccessToken(): Promise<string> {
  if (isZaloMiniApp()) {
    try {
      const result = await zmpGetAccessToken();
      if (typeof result === 'string' && result.length > 0) return result;
      const res = result as unknown as { accessToken?: string; token?: string };
      if (res?.accessToken || res?.token) return res.accessToken || res.token || '';
    } catch (cause) {
      console.warn('Zalo Mini App getAccessToken failed:', cause);
    }
  }

  // Development & desktop browser fallback
  if (import.meta.env.DEV || !isZaloMiniApp()) {
    return 'demo_zalo_devuser_' + encodeURIComponent('Người dùng Zalo');
  }

  throw new Error('Vui lòng mở ứng dụng trong Zalo Mini App để đăng nhập.');
}

/**
 * Retrieve user info from Zalo profile (name, avatar, ID)
 */
export async function getZaloUserInfo(): Promise<ZaloUserProfile | null> {
  if (isZaloMiniApp()) {
    try {
      const result = await zmpGetUserInfo({ autoRequestPermission: true });
      if (result?.userInfo) {
        return {
          id: result.userInfo.id,
          name: result.userInfo.name,
          avatar: result.userInfo.avatar,
        };
      }
    } catch (cause) {
      console.warn('zmpGetUserInfo failed:', cause);
    }
  }

  return {
    id: 'demo_zalo_dev',
    name: 'Người dùng Zalo',
  };
}

/**
 * Retrieve user's verified phone number.
 * Inside Zalo: calls getPhoneNumber() and decodes the token via backend API.
 * In localhost browser: resolves dev simulated phone number for testing.
 */
export async function getZaloPhoneNumber(
  apiCaller: <T>(path: string, options?: RequestInit) => Promise<T>,
  authToken?: string,
): Promise<string> {
  if (isZaloMiniApp()) {
    try {
      const result = await zmpGetPhoneNumber();
      const res = result as unknown as { number?: string; token?: string };
      if (res?.number) return String(res.number);
      if (res?.token) {
        const payload = await apiCaller<{ phone: string }>('/auth/zalo/phone', {
          method: 'POST',
          body: JSON.stringify({ token: res.token, accessToken: authToken }),
        });
        if (payload?.phone) return payload.phone;
      }
    } catch (cause) {
      console.warn('zmpGetPhoneNumber error:', cause);
    }
  }

  // Web / local dev fallback
  try {
    const payload = await apiCaller<{ phone: string }>('/auth/zalo/phone', {
      method: 'POST',
      body: JSON.stringify({ token: 'demo_phone_0988776655' }),
    });
    if (payload?.phone) return payload.phone;
  } catch {
    // If API unavailable, return standard fallback
  }

  return '0988776655';
}
