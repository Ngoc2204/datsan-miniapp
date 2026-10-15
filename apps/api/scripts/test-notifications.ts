import assert from 'node:assert/strict';
import { buildBookingEmail } from '../src/notifications/booking-email';
import { readMailConfiguration } from '../src/notifications/mail-config';

assert.equal(readMailConfiguration({}), undefined);

const smtp = readMailConfiguration({
  SMTP_HOST: ' smtp.example.test ',
  SMTP_PORT: '587',
  SMTP_USER: 'mailer@example.test',
  SMTP_PASSWORD: 'test-password',
  MAIL_FROM: 'DatSan <mailer@example.test>',
});
assert.ok(smtp);
assert.equal(smtp.transport.host, 'smtp.example.test');
assert.equal(smtp.transport.port, 587);
assert.equal(smtp.transport.secure, false);
assert.equal(smtp.from, 'DatSan <mailer@example.test>');
assert.throws(() => readMailConfiguration({ SMTP_HOST: 'smtp.example.test' }), /SMTP_USER/);
assert.throws(() => readMailConfiguration({
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: 'bad', SMTP_USER: 'mailer@example.test', SMTP_PASSWORD: 'x',
}), /SMTP_PORT/);
assert.equal(readMailConfiguration({
  SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_USER: 'mailer@example.test', SMTP_PASSWORD: 'x',
})?.transport.secure, true);

const details = {
  kind: 'booking_confirmation' as const,
  bookingId: 'booking-123',
  contactName: '<script>alert(1)</script>',
  venueName: 'Sân <img src=x>',
  address: '12 Đường A & B',
  courtName: 'Sân 1',
  startAt: new Date('2026-10-16T11:00:00.000Z'),
  endAt: new Date('2026-10-16T12:00:00.000Z'),
  timezone: 'Asia/Ho_Chi_Minh',
  total: '200000',
  currency: 'VND',
};
const confirmation = buildBookingEmail(details);
assert.equal(confirmation.subject, 'DatSan | Đặt sân đã được xác nhận');
assert.match(confirmation.text, /18:00–19:00/);
assert.match(confirmation.text, /200\.000/);
assert.match(confirmation.html, /&lt;script&gt;/);
assert.match(confirmation.html, /&lt;img src=x&gt;/);
assert.doesNotMatch(confirmation.html, /<script>|<img src=x>/);
assert.match(buildBookingEmail({ ...details, kind: 'reminder_24h' }).subject, /ngày mai/);
assert.match(buildBookingEmail({ ...details, kind: 'reminder_2h' }).subject, /2 giờ/);

console.log('Notification config and email template checks passed.');
