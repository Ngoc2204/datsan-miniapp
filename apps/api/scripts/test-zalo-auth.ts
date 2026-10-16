import assert from 'node:assert/strict';
import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from '../src/database/database.service';
import { AuthService } from '../src/auth/auth.service';

const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const originalZaloSecret = process.env.ZALO_APP_SECRET;

const activeAccount = {
  id: 'account-123',
  email: null,
  phone: null,
  full_name: null,
  platform_role: 'customer' as const,
  password_hash: null,
  active: true,
};

function createService(account = activeAccount) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const database = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [account] };
    },
  };
  const jwt = {
    signAsync: async (claims: { sub: string }) => `jwt:${claims.sub}`,
  };
  return {
    service: new AuthService(database as unknown as DatabaseService, jwt as unknown as JwtService),
    calls,
  };
}

async function run() {
  process.env.NODE_ENV = 'production';

  const success = createService();
  let requestedUrl: URL | undefined;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    return new Response(JSON.stringify({ id: 'zalo-user-789' }), { status: 200 });
  };
  const result = await success.service.loginWithZalo({ accessToken: 'real-access-token-for-zalo-test' });
  assert.equal(requestedUrl?.pathname, '/v2.0/me');
  assert.equal(requestedUrl?.searchParams.get('fields'), 'id');
  assert.equal(requestedUrl?.searchParams.get('access_token'), 'real-access-token-for-zalo-test');
  assert.deepEqual(success.calls[0].values, ['zalo-user-789', null]);
  assert.equal(result.accessToken, 'jwt:account-123');
  assert.equal(result.user.id, 'account-123');

  const invalid = createService();
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 });
  };
  await assert.rejects(
    invalid.service.loginWithZalo({ accessToken: 'demo_zalo_fabricated-token-on-production' }),
    UnauthorizedException,
  );
  assert.equal(fetchCalled, true, 'production must verify even demo-prefixed tokens with Zalo');
  assert.equal(invalid.calls.length, 0, 'invalid tokens must not create accounts');

  const malformed = createService();
  globalThis.fetch = async () => new Response('not-json', { status: 200 });
  await assert.rejects(
    malformed.service.loginWithZalo({ accessToken: 'real-access-token-for-zalo-test' }),
    UnauthorizedException,
  );
  assert.equal(malformed.calls.length, 0);

  const unavailable = createService();
  globalThis.fetch = async () => { throw new Error('network unavailable'); };
  await assert.rejects(
    unavailable.service.loginWithZalo({ accessToken: 'real-access-token-for-zalo-test' }),
    ServiceUnavailableException,
  );
  assert.equal(unavailable.calls.length, 0);

  const inactive = createService({ ...activeAccount, active: false });
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 'zalo-user-789' }), { status: 200 });
  await assert.rejects(
    inactive.service.loginWithZalo({ accessToken: 'real-access-token-for-zalo-test' }),
    UnauthorizedException,
  );

  delete process.env.ZALO_APP_SECRET;
  await assert.rejects(
    success.service.resolveZaloPhone({ token: 'demo_phone_0988776655' }),
    ServiceUnavailableException,
  );

  process.env.NODE_ENV = 'development';
  const localDemo = createService();
  globalThis.fetch = async () => { throw new Error('demo token should not reach Zalo'); };
  const demoResult = await localDemo.service.loginWithZalo({
    accessToken: 'demo_zalo_devuser_Ng%C6%B0%E1%BB%9Di%20d%C3%B9ng%20Zalo',
  });
  assert.deepEqual(localDemo.calls[0].values, ['zalo_dev_devuser', 'Người dùng Zalo']);
  assert.equal(demoResult.accessToken, 'jwt:account-123');
  assert.equal(
    (await localDemo.service.resolveZaloPhone({ token: 'demo_phone_0988776655' })).phone,
    '0988776655',
  );

  console.log('Zalo authentication checks passed.');
}

run().finally(() => {
  globalThis.fetch = originalFetch;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalZaloSecret === undefined) delete process.env.ZALO_APP_SECRET;
  else process.env.ZALO_APP_SECRET = originalZaloSecret;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
