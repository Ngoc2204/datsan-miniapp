import { ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../database/database.service';
import { LoginDto, RegisterBusinessDto, RegisterCustomerDto, UpdateProfileDto, ZaloLoginDto, ZaloPhoneDto } from './auth.dto';
import { hashPassword, verifyPassword } from './password';
import { AuthUser } from './auth.types';

type AccountRow = {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  platform_role: 'customer' | 'platform_admin';
  password_hash: string | null;
  active: boolean;
};

@Injectable()
export class AuthService {
  constructor(private readonly database: DatabaseService, private readonly jwt: JwtService) {}

  async registerBusiness(input: RegisterBusinessDto) {
    const passwordHash = await hashPassword(input.password);
    try {
      const account = await this.database.transaction(async (client) => {
        const userResult = await client.query<AccountRow>(
          'INSERT INTO user_accounts (email, phone, full_name, password_hash) ' +
          'VALUES ($1, $2, $3, $4) ' +
          'RETURNING id, email, phone, full_name, platform_role, password_hash, active',
          [input.email, input.phone?.trim() || null, input.fullName.trim(), passwordHash],
        );
        const user = userResult.rows[0];
        const businessResult = await client.query<{ id: string; status: string }>(
          'INSERT INTO businesses (display_name) VALUES ($1) RETURNING id, status',
          [input.businessName.trim()],
        );
        await client.query(
          "INSERT INTO business_memberships (business_id, user_id, membership_role) VALUES ($1, $2, 'owner')",
          [businessResult.rows[0].id, user.id],
        );
        return { user, business: businessResult.rows[0] };
      });
      return {
        user: this.publicUser(account.user),
        business: account.business,
        accessToken: await this.jwt.signAsync({ sub: account.user.id }),
      };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Email đã được sử dụng');
      }
      throw error;
    }
  }

  async registerCustomer(input: RegisterCustomerDto) {
    const passwordHash = await hashPassword(input.password);
    try {
      const result = await this.database.query<AccountRow>(
        'INSERT INTO user_accounts (email, phone, full_name, password_hash) ' +
        'VALUES ($1, $2, $3, $4) ' +
        'RETURNING id, email, phone, full_name, platform_role, password_hash, active',
        [input.email, input.phone?.trim() || null, input.fullName.trim(), passwordHash],
      );
      return {
        user: this.publicUser(result.rows[0]),
        accessToken: await this.jwt.signAsync({ sub: result.rows[0].id }),
      };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Email đã được sử dụng');
      }
      throw error;
    }
  }

  async login(input: LoginDto) {
    const result = await this.database.query<AccountRow>(
      'SELECT id, email, phone, full_name, platform_role, password_hash, active ' +
      'FROM user_accounts WHERE lower(email) = $1 LIMIT 1',
      [input.email],
    );
    const account = result.rows[0];
    const valid = account?.password_hash
      ? await verifyPassword(input.password, account.password_hash)
      : false;
    if (!account?.active || !valid) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }
    return {
      user: this.publicUser(account),
      accessToken: await this.jwt.signAsync({ sub: account.id }),
    };
  }

  async loginWithZalo(input: ZaloLoginDto) {
    let profile: { id?: string; name?: string };
    if (process.env.NODE_ENV !== 'production' && input.accessToken.startsWith('demo_zalo_')) {
      const payload = input.accessToken.replace('demo_zalo_', '');
      let name = 'Người dùng Zalo (Demo)';
      if (payload.split('_')[1]) {
        try {
          name = decodeURIComponent(payload.split('_')[1]);
        } catch {
          // Keep the safe demo name for a malformed local token.
        }
      }
      profile = {
        id: 'zalo_dev_' + (payload.split('_')[0] || '123456789'),
        name,
      };
    } else {
      const url = new URL('https://graph.zalo.me/v2.0/me');
      // The default Mini App access token is enough to identify the user. Avoid
      // requesting profile fields that require an additional userInfo scope.
      url.searchParams.set('fields', 'id');
      url.searchParams.set('access_token', input.accessToken);
      let response: Response;
      try {
        response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      } catch {
        throw new ServiceUnavailableException('Không kết nối được dịch vụ xác thực Zalo');
      }
      if (!response.ok) throw new UnauthorizedException('Access token Zalo không hợp lệ');

      let responseProfile: unknown;
      try {
        responseProfile = await response.json();
      } catch {
        throw new UnauthorizedException('Zalo không trả về hồ sơ người dùng hợp lệ');
      }
      const data = responseProfile && typeof responseProfile === 'object'
        ? responseProfile as { id?: unknown; name?: unknown }
        : {};
      const id = typeof data.id === 'string' || typeof data.id === 'number' ? String(data.id) : '';
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) {
        throw new UnauthorizedException('Zalo không trả về hồ sơ người dùng hợp lệ');
      }
      profile = { id, name: typeof data.name === 'string' ? data.name : undefined };
    }

    const result = await this.database.query<AccountRow>(
      'INSERT INTO user_accounts (zalo_user_id, full_name) VALUES ($1, $2) ' +
      'ON CONFLICT (zalo_user_id) DO UPDATE SET ' +
      'full_name = COALESCE(EXCLUDED.full_name, user_accounts.full_name), updated_at = now() ' +
      'RETURNING id, email, phone, full_name, platform_role, password_hash, active',
      [profile.id, profile.name?.trim() || null],
    );
    const account = result.rows[0];
    if (!account.active) throw new UnauthorizedException('Tài khoản không còn hoạt động');
    return {
      user: this.publicUser(account),
      accessToken: await this.jwt.signAsync({ sub: account.id }),
    };
  }

  async resolveZaloPhone(input: ZaloPhoneDto, authHeader?: string) {
    let user: AuthUser | undefined;
    const [scheme, token] = authHeader?.split(' ') ?? [];
    if (scheme?.toLowerCase() === 'bearer' && token) {
      try {
        const claims = await this.jwt.verifyAsync<{ sub?: string }>(token);
        if (claims.sub) user = await this.getProfile(claims.sub);
      } catch {
        // Continue unauthenticated if token invalid
      }
    }

    let phoneNumber = '';
    const secret = process.env.ZALO_APP_SECRET;

    if (secret && input.accessToken) {
      try {
        const response = await fetch('https://graph.zalo.me/v2.0/me/info', {
          method: 'GET',
          headers: {
            access_token: input.accessToken,
            code: input.token,
            secret_key: secret,
          },
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          const data = await response.json() as { data?: { number?: string } };
          phoneNumber = data.data?.number || '';
        }
      } catch {
        // Fallback below if external request fails
      }
    }

    if (!phoneNumber) {
      if (process.env.NODE_ENV !== 'production' && input.token.startsWith('demo_phone_')) {
        phoneNumber = input.token.replace('demo_phone_', '');
      } else if (process.env.NODE_ENV !== 'production') {
        phoneNumber = '0988776655';
      } else {
        throw new ServiceUnavailableException('Không giải mã được số điện thoại Zalo.');
      }
    }

    if (user?.id && phoneNumber) {
      await this.database.query(
        'UPDATE user_accounts SET phone = COALESCE($2, phone), updated_at = now() WHERE id = $1',
        [user.id, phoneNumber],
      );
    }

    return { phone: phoneNumber };
  }

  async updateProfile(userId: string, input: UpdateProfileDto) {
    try {
      await this.database.query(
        'UPDATE user_accounts SET full_name = COALESCE($2, full_name), email = COALESCE($3, email), phone = COALESCE($4, phone), updated_at = now() WHERE id = $1 AND active = true',
        [userId, input.fullName?.trim() || null, input.email?.trim().toLowerCase() || null, input.phone?.trim() || null],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('Email đã được sử dụng');
      throw error;
    }
    return this.getProfile(userId);
  }

  async getProfile(userId: string) {
    const result = await this.database.query<AccountRow>(
      'SELECT id, email, phone, full_name, platform_role, password_hash, active ' +
      'FROM user_accounts WHERE id = $1 AND active = true',
      [userId],
    );
    if (!result.rows[0]) throw new UnauthorizedException();
    return this.publicUser(result.rows[0]);
  }

  private publicUser(account: AccountRow): AuthUser {
    return {
      id: account.id,
      email: account.email,
      phone: account.phone,
      fullName: account.full_name,
      platformRole: account.platform_role,
    };
  }
}
