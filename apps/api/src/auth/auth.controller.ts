import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginDto, RegisterBusinessDto, RegisterCustomerDto, UpdateProfileDto, ZaloLoginDto, ZaloPhoneDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('business/register')
  registerBusiness(@Body() input: RegisterBusinessDto) {
    return this.auth.registerBusiness(input);
  }

  @Post('customer/register')
  registerCustomer(@Body() input: RegisterCustomerDto) {
    return this.auth.registerCustomer(input);
  }

  @Post('zalo')
  loginWithZalo(@Body() input: ZaloLoginDto) {
    return this.auth.loginWithZalo(input);
  }

  @Post('zalo/phone')
  resolveZaloPhone(@Req() request: Request, @Body() input: ZaloPhoneDto) {
    return this.auth.resolveZaloPhone(input, request.headers.authorization);
  }

  @Post('login')
  login(@Body() input: LoginDto) {
    return this.auth.login(input);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  updateMe(@Req() request: Request, @Body() input: UpdateProfileDto) {
    return this.auth.updateProfile(request.authUser!.id, input);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() request: Request) {
    return this.auth.getProfile(request.authUser!.id);
  }
}
