export type BookingNotificationKind = 'booking_confirmation' | 'reminder_24h' | 'reminder_2h';

export type BookingEmailDetails = {
  kind: BookingNotificationKind;
  bookingId: string;
  contactName: string | null;
  venueName: string;
  address: string;
  courtName: string;
  startAt: Date;
  endAt: Date;
  timezone: string;
  total: string | number;
  currency: string;
};

export type BookingEmail = { subject: string; text: string; html: string };

function safeText(value: string) {
  return value.replace(/[\r\n\t]+/g, ' ').trim();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

export function buildBookingEmail(details: BookingEmailDetails): BookingEmail {
  const name = safeText(details.contactName || 'bạn') || 'bạn';
  const venue = safeText(details.venueName);
  const address = safeText(details.address);
  const court = safeText(details.courtName);
  const bookingId = safeText(details.bookingId);
  const date = new Intl.DateTimeFormat('vi-VN', {
    timeZone: details.timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(details.startAt);
  const times = new Intl.DateTimeFormat('vi-VN', {
    timeZone: details.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const timeRange = `${times.format(details.startAt)}–${times.format(details.endAt)}`;
  const total = new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: details.currency,
    maximumFractionDigits: 0,
  }).format(Number(details.total));

  const copy = details.kind === 'booking_confirmation'
    ? {
      subject: 'datsan247 | Đặt sân đã được xác nhận',
      title: 'Đặt sân thành công',
      intro: 'Lịch đặt sân của bạn đã được xác nhận. Hẹn gặp bạn tại sân!',
    }
    : details.kind === 'reminder_24h'
      ? {
        subject: 'datsan247 | Nhắc lịch chơi ngày mai',
        title: 'Lịch chơi ngày mai',
        intro: 'Còn khoảng 24 giờ nữa là đến lịch chơi của bạn.',
      }
      : {
        subject: 'datsan247 | Nhắc bạn còn 2 giờ đến giờ sân',
        title: 'Sắp đến giờ chơi',
        intro: 'Còn khoảng 2 giờ nữa là đến lịch đặt sân của bạn.',
      };

  const text = [
    `Xin chào ${name},`,
    copy.intro,
    '',
    `Địa điểm: ${venue}`,
    `Địa chỉ: ${address}`,
    `Sân: ${court}`,
    `Ngày: ${date}`,
    `Giờ: ${timeRange}`,
    `Tổng tiền: ${total}`,
    `Mã đặt chỗ: ${bookingId}`,
    '',
    'datsan247 — Đặt sân thể thao dễ dàng.',
  ].join('\n');

  const rows = [
    ['Địa điểm', venue],
    ['Địa chỉ', address],
    ['Sân', court],
    ['Ngày', date],
    ['Giờ', timeRange],
    ['Tổng tiền', total],
    ['Mã đặt chỗ', bookingId],
  ].map(([label, value]) =>
    `<tr><td style="padding:10px 0;color:#65736b;border-bottom:1px solid #e8eee9">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 0;text-align:right;color:#18251d;font-weight:600;border-bottom:1px solid #e8eee9">${escapeHtml(value)}</td></tr>`,
  ).join('');

  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;background:#f3f7f4;font-family:Arial,Helvetica,sans-serif;color:#18251d">` +
    `<div style="max-width:600px;margin:0 auto;padding:32px 16px">` +
    `<div style="padding:20px 24px;background:#143b2b;border-radius:16px 16px 0 0;color:#fff">` +
    `<div style="font-size:22px;font-weight:700;letter-spacing:.2px">datsan247</div>` +
    `<div style="margin-top:5px;font-size:12px;color:#bde6ca">ĐẶT SÂN THỂ THAO DỄ DÀNG</div></div>` +
    `<div style="padding:28px 24px;background:#fff;border:1px solid #e5ece7;border-top:0;border-radius:0 0 16px 16px">` +
    `<h1 style="margin:0 0 10px;font-size:24px;line-height:1.3">${escapeHtml(copy.title)}</h1>` +
    `<p style="margin:0 0 22px;color:#526158;line-height:1.6">Xin chào ${escapeHtml(name)}, ${escapeHtml(copy.intro)}</p>` +
    `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` +
    `<p style="margin:22px 0 0;color:#65736b;font-size:12px;line-height:1.6">Email tự động từ datsan247. Vui lòng giữ lại mã đặt chỗ để tiện tra cứu.</p>` +
    `</div><p style="margin:16px 0 0;text-align:center;color:#8a968e;font-size:12px">datsan247 · Đặt sân, sẵn sàng ra sân</p>` +
    `</div></body></html>`;

  return { subject: copy.subject, text, html };
}
