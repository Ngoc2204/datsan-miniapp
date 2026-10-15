import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from './auth.types';

type TokenClaims = { sub?: string };
type UserRow = { id: string; email: string | null; phone: string | null; full_name: string | null; platform_role: 'customer' | 'platform_admin' };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException('Cần đăng nhập');
    }

    let claims: TokenClaims;
    try {
      claims = await this.jwt.verifyAsync<TokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn');
    }
    if (!claims.sub) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ');

    const result = await this.database.query<UserRow>(
      'SELECT id, email, phone, full_name, platform_role FROM user_accounts WHERE id = $1 AND active = true',
      [claims.sub],
    );
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException('Tài khoản không còn hoạt động');

    const user: AuthUser = {
      id: row.id,
      email: row.email,
      phone: row.phone,
      fullName: row.full_name,
      platformRole: row.platform_role,
    };
    request.authUser = user;
    return true;
  }
}
