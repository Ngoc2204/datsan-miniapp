export type MailConfiguration = {
  from: string;
  transport: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
    connectionTimeout: number;
    greetingTimeout: number;
    socketTimeout: number;
  };
};

export function readMailConfiguration(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MailConfiguration | undefined {
  const host = env.SMTP_HOST?.trim();
  if (!host) return undefined;

  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD?.trim();
  if (!user || !password) {
    throw new Error('SMTP_USER và SMTP_PASSWORD là bắt buộc khi đã cấu hình SMTP_HOST.');
  }

  const rawPort = env.SMTP_PORT?.trim() || '587';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('SMTP_PORT phải là số nguyên từ 1 đến 65535.');
  }

  const rawSecure = env.SMTP_SECURE?.trim().toLowerCase();
  if (rawSecure && rawSecure !== 'true' && rawSecure !== 'false') {
    throw new Error('SMTP_SECURE chỉ nhận true hoặc false.');
  }

  const from = env.MAIL_FROM?.trim() || user;
  return {
    from,
    transport: {
      host,
      port,
      secure: rawSecure ? rawSecure === 'true' : port === 465,
      auth: { user, pass: password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    },
  };
}
