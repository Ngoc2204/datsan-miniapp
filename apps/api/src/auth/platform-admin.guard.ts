import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.authUser?.platformRole !== 'platform_admin') {
      throw new ForbiddenException('Chỉ quản trị viên nền tảng được phép thao tác');
    }
    return true;
  }
}
