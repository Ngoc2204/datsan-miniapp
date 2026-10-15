export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  platformRole: 'customer' | 'platform_admin';
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}
