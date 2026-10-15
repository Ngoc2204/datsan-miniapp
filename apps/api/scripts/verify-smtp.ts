import { config } from 'dotenv';
import { createTransport } from 'nodemailer';
import { resolve } from 'node:path';
import { readMailConfiguration } from '../src/notifications/mail-config';

async function main() {
  config({ path: resolve(__dirname, '../../../.env') });
  const mail = readMailConfiguration();
  if (!mail) throw new Error('SMTP_HOST chưa được cấu hình trong .env.');

  const transport = createTransport(mail.transport);
  try {
    await transport.verify();
    console.log('Kết nối SMTP và xác thực thành công. Chưa gửi email nào.');
  } finally {
    transport.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error && error.message.startsWith('SMTP_')
    ? error.message
    : error instanceof Error && error.message.startsWith('SMTP_HOST')
      ? error.message
      : 'Kiểm tra SMTP thất bại. Hãy kiểm tra host, port, chế độ TLS và thông tin xác thực; không email nào được gửi.';
  console.error(message);
  process.exitCode = 1;
});
