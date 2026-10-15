import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Pool } from 'pg';

config({ path: resolve(__dirname, '../../../.env') });

async function seedVenues(): Promise<void> {
  const connectionString = process.env.DATABASE_URL || '';
  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const useSsl = process.env.DATABASE_SSL === 'true' || (!isLocal && !connectionString.includes('sslmode=disable'));
  const pool = new Pool({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get sports
    const sportsRes = await client.query<{ id: string; code: string }>('SELECT id, code FROM sports');
    const sportsMap = new Map(sportsRes.rows.map((r) => [r.code, r.id]));

    // 1. Create or get business
    let bizRes = await client.query<{ id: string }>(
      "SELECT id FROM businesses WHERE display_name = 'DatSan Sports Club'",
    );
    let bizId: string;
    if (bizRes.rows.length === 0) {
      bizRes = await client.query<{ id: string }>(
        "INSERT INTO businesses (display_name, status) VALUES ('DatSan Sports Club', 'approved') RETURNING id",
      );
      bizId = bizRes.rows[0].id;
    } else {
      bizId = bizRes.rows[0].id;
    }

    const venuesData = [
      {
        name: 'Sân Cầu Lông & Pickleball DatSan Star',
        address: '128 Nguyễn Thị Thập, Tân Phú, Quận 7, TP. Hồ Chí Minh',
        lat: 10.7324,
        lng: 106.7156,
        description: 'Tổ hợp sân thể thao tiêu chuẩn quốc tế, thảm sàn chống trơn trượt, đèn LED chống chói, máy lạnh và khu vực giải khát.',
        sports: ['badminton', 'pickleball'],
        courts: [
          { name: 'Sân Cầu Lông 01 (VIP)', sport: 'badminton', price: 90000, primePrice: 130000 },
          { name: 'Sân Cầu Lông 02', sport: 'badminton', price: 80000, primePrice: 120000 },
          { name: 'Sân Pickleball 01', sport: 'pickleball', price: 120000, primePrice: 160000 },
          { name: 'Sân Pickleball 02', sport: 'pickleball', price: 120000, primePrice: 160000 },
        ],
        media: [
          'https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&auto=format&fit=crop&q=80',
        ],
      },
      {
        name: 'Tổ Hợp Sân Bóng Đá & Cầu Lông DatSan Arena',
        address: '58 Trần Thái Tông, Cầu Giấy, Hà Nội',
        lat: 21.0333,
        lng: 105.7894,
        description: 'Mặt cỏ nhân tạo cao cấp đạt chuẩn FIFA, hệ thống thoát nước hiện đại, có phòng tắm nóng lạnh và bãi đỗ xe ô tô rộng rãi.',
        sports: ['football', 'badminton'],
        courts: [
          { name: 'Sân Bóng Đá 7 người A', sport: 'football', price: 300000, primePrice: 450000 },
          { name: 'Sân Bóng Đá 7 người B', sport: 'football', price: 300000, primePrice: 450000 },
          { name: 'Sân Cầu Lông Trong Nhà A', sport: 'badminton', price: 90000, primePrice: 130000 },
        ],
        media: [
          'https://images.unsplash.com/photo-1529900748604-07564a03e7a6?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&auto=format&fit=crop&q=80',
        ],
      },
      {
        name: 'CLB Tennis & Pickleball Riverside',
        address: '215 Nguyễn Văn Hưởng, Thảo Điền, TP. Thủ Đức, TP. Hồ Chí Minh',
        lat: 10.8012,
        lng: 106.7412,
        description: 'Khu liên hợp thể thao ven sông thoáng mát, mặt sân đất nện và cứng tiêu chuẩn ITF, có HLV chuyên nghiệp hướng dẫn.',
        sports: ['tennis', 'pickleball'],
        courts: [
          { name: 'Sân Tennis 01 (Mặt cứng)', sport: 'tennis', price: 180000, primePrice: 250000 },
          { name: 'Sân Pickleball Pro', sport: 'pickleball', price: 130000, primePrice: 170000 },
        ],
        media: [
          'https://images.unsplash.com/photo-1595435934249-5df7ed86e1c0?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=800&auto=format&fit=crop&q=80',
        ],
      },
    ];

    const todayStr = new Date().toISOString().slice(0, 10);

    for (const vData of venuesData) {
      // Check if venue exists
      let vRes = await client.query<{ id: string }>(
        'SELECT id FROM venues WHERE business_id = $1 AND name = $2',
        [bizId, vData.name],
      );
      let venueId: string;
      if (vRes.rows.length === 0) {
        vRes = await client.query<{ id: string }>(
          `INSERT INTO venues (business_id, name, address, latitude, longitude, description, timezone, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'Asia/Ho_Chi_Minh', 'approved') RETURNING id`,
          [bizId, vData.name, vData.address, vData.lat, vData.lng, vData.description],
        );
        venueId = vRes.rows[0].id;
      } else {
        venueId = vRes.rows[0].id;
      }

      // Sports mapping
      for (const spCode of vData.sports) {
        const spId = sportsMap.get(spCode);
        if (spId) {
          await client.query(
            'INSERT INTO venue_sports (business_id, venue_id, sport_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [bizId, venueId, spId],
          );
        }
      }

      // Media
      for (let i = 0; i < vData.media.length; i++) {
        await client.query(
          `INSERT INTO venue_media (business_id, venue_id, media_url, sort_order)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [bizId, venueId, vData.media[i], i],
        );
      }

      // Courts
      for (const cData of vData.courts) {
        const spId = sportsMap.get(cData.sport);
        if (!spId) continue;

        let courtRes = await client.query<{ id: string }>(
          'SELECT id FROM courts WHERE venue_id = $1 AND name = $2',
          [venueId, cData.name],
        );
        let courtId: string;
        if (courtRes.rows.length === 0) {
          courtRes = await client.query<{ id: string }>(
            `INSERT INTO courts (business_id, venue_id, sport_id, name, active)
             VALUES ($1, $2, $3, $4, true) RETURNING id`,
            [bizId, venueId, spId, cData.name],
          );
          courtId = courtRes.rows[0].id;

          // Court booking rules
          await client.query(
            `INSERT INTO court_booking_rules (business_id, court_id, default_duration_minutes, minimum_duration_minutes, maximum_duration_minutes, slot_interval_minutes)
             VALUES ($1, $2, 60, 60, 180, 30)`,
            [bizId, courtId],
          );

          // Operating hours (0 = Sun, 1 = Mon, ..., 6 = Sat)
          for (let day = 0; day <= 6; day++) {
            await client.query(
              `INSERT INTO court_operating_hours (business_id, court_id, weekday, opens_at, closes_at)
               VALUES ($1, $2, $3, '06:00', '23:00')`,
              [bizId, courtId, day],
            );

            // Regular hours (06:00 - 17:00)
            await client.query(
              `INSERT INTO price_rules (business_id, court_id, weekday, starts_at, ends_at, price_per_hour, effective_from, active)
               VALUES ($1, $2, $3, '06:00', '17:00', $4, $5, true)`,
              [bizId, courtId, day, cData.price, todayStr],
            );

            // Prime hours (17:00 - 23:00)
            await client.query(
              `INSERT INTO price_rules (business_id, court_id, weekday, starts_at, ends_at, price_per_hour, effective_from, active)
               VALUES ($1, $2, $3, '17:00', '23:00', $4, $5, true)`,
              [bizId, courtId, day, cData.primePrice, todayStr],
            );
          }
        }
      }
    }

    await client.query('COMMIT');
    console.log('Sample venues, courts, and pricing seeded successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error seeding venues:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

void seedVenues();
