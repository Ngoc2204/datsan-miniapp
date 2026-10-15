import { BadRequestException } from '@nestjs/common';

export type PriceWindow = { start: number; end: number; pricePerHour: number };

export function timeToMinutes(value: string): number {
  const parts = value.split(':').map(Number);
  return parts[0] * 60 + parts[1];
}

export function formatTime(minutes: number): string {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
    String(minutes % 60).padStart(2, '0');
}

export function quotePrice(start: number, duration: number, rules: PriceWindow[]): number | null {
  let cursor = start;
  const end = start + duration;
  let total = 0;
  while (cursor < end) {
    const rule = rules.find((candidate) => candidate.start <= cursor && candidate.end > cursor);
    if (!rule) return null;
    const segmentEnd = Math.min(end, rule.end);
    total += rule.pricePerHour * (segmentEnd - cursor) / 60;
    cursor = segmentEnd;
  }
  return Math.round(total);
}

export function dateWeekday(date: string): number {
  return new Date(date + 'T00:00:00.000Z').getUTCDay();
}

export function assertDateOnly(value: string): void {
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Ngày không hợp lệ');
  }
}
