import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSportDto, ReviewBusinessDto, UpdateSportDto, UpdateUserActiveDto } from './admin.dto';
import { ReviewReportDto } from '../community/community.dto';

@Injectable()
export class AdminService {
  constructor(private readonly database: DatabaseService) {}

  async listBusinesses(status?: string) {
    const allowed = ['pending_review', 'approved', 'rejected', 'suspended'];
    if (status && !allowed.includes(status)) throw new BadRequestException('Trạng thái không hợp lệ');
    const result = await this.database.query(
      'SELECT b.id, b.display_name, b.status, b.review_reason, b.created_at, ' +
      'u.id AS owner_id, u.full_name AS owner_name, u.email AS owner_email ' +
      'FROM businesses b ' +
      'LEFT JOIN business_memberships m ON m.business_id = b.id AND m.membership_role = $1 AND m.active = true ' +
      'LEFT JOIN user_accounts u ON u.id = m.user_id ' +
      'WHERE ($2::text IS NULL OR b.status = $2) ' +
      'ORDER BY b.created_at ASC',
      ['owner', status ?? null],
    );
    return result.rows;
  }

  async reviewBusiness(businessId: string, actorId: string, input: ReviewBusinessDto) {
    if ((input.outcome === 'rejected' || input.outcome === 'suspended') && !input.reason?.trim()) {
      throw new BadRequestException('Cần ghi lý do khi từ chối hoặc tạm khóa');
    }
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string }>(
        'SELECT status FROM businesses WHERE id = $1 FOR UPDATE',
        [businessId],
      );
      const business = current.rows[0];
      if (!business) throw new NotFoundException('Không tìm thấy hồ sơ chủ sân');
      if (input.outcome === 'suspended' && business.status !== 'approved') {
        throw new BadRequestException('Chỉ có thể tạm khóa hồ sơ đã được duyệt');
      }
      if (input.outcome === 'approved' && !['pending_review', 'suspended'].includes(business.status)) {
        throw new BadRequestException('Hồ sơ này không ở trạng thái có thể duyệt lại');
      }
      if (input.outcome === 'rejected' && business.status !== 'pending_review') {
        throw new BadRequestException('Chỉ hồ sơ đang chờ duyệt mới có thể bị từ chối');
      }
      const reason = input.outcome === 'approved' ? null : input.reason!.trim();
      const updated = await client.query(
        'UPDATE businesses SET status = $2, review_reason = $3, reviewed_by_user_id = $4, ' +
        'reviewed_at = now(), updated_at = now() WHERE id = $1 ' +
        'RETURNING id, display_name, status, review_reason, reviewed_at',
        [businessId, input.outcome, reason, actorId],
      );
      await client.query(
        'INSERT INTO admin_audit_log (actor_user_id, action, entity_type, entity_id, details) ' +
        'VALUES ($1, $2, $3, $4, $5::jsonb)',
        [actorId, 'business.' + input.outcome, 'business', businessId, JSON.stringify({ reason })],
      );
      return updated.rows[0];
    });
  }

  async listVenues(status?: string) {
    const allowed = ['draft', 'pending_review', 'approved', 'rejected', 'suspended'];
    if (status && !allowed.includes(status)) throw new BadRequestException('Trạng thái không hợp lệ');
    const result = await this.database.query(
      'SELECT v.id, v.name, v.address, v.status, v.review_reason, v.created_at, ' +
      'b.id AS business_id, b.display_name AS business_name, count(c.id)::int AS court_count ' +
      'FROM venues v JOIN businesses b ON b.id = v.business_id ' +
      'LEFT JOIN courts c ON c.business_id = v.business_id AND c.venue_id = v.id ' +
      'WHERE ($1::text IS NULL OR v.status = $1) ' +
      'GROUP BY v.id, b.id ORDER BY v.created_at ASC',
      [status ?? null],
    );
    return result.rows;
  }

  async reviewVenue(venueId: string, actorId: string, input: ReviewBusinessDto) {
    if ((input.outcome === 'rejected' || input.outcome === 'suspended') && !input.reason?.trim()) {
      throw new BadRequestException('Cần ghi lý do khi từ chối hoặc tạm khóa');
    }
    return this.database.transaction(async (client) => {
      const current = await client.query<{ status: string; business_id: string }>(
        'SELECT status, business_id FROM venues WHERE id = $1 FOR UPDATE',
        [venueId],
      );
      const venue = current.rows[0];
      if (!venue) throw new NotFoundException('Không tìm thấy địa điểm');
      if (input.outcome === 'suspended' && venue.status !== 'approved') {
        throw new BadRequestException('Chỉ có thể tạm khóa địa điểm đã được duyệt');
      }
      if (input.outcome === 'approved' && !['pending_review', 'suspended'].includes(venue.status)) {
        throw new BadRequestException('Địa điểm này không ở trạng thái có thể duyệt lại');
      }
      if (input.outcome === 'rejected' && venue.status !== 'pending_review') {
        throw new BadRequestException('Chỉ địa điểm đang chờ duyệt mới có thể bị từ chối');
      }
      const reason = input.outcome === 'approved' ? null : input.reason!.trim();
      const updated = await client.query(
        'UPDATE venues SET status = $2, review_reason = $3, reviewed_by_user_id = $4, ' +
        'reviewed_at = now(), updated_at = now() WHERE id = $1 ' +
        'RETURNING id, name, status, review_reason, reviewed_at',
        [venueId, input.outcome, reason, actorId],
      );
      await client.query(
        'INSERT INTO admin_audit_log (actor_user_id, action, entity_type, entity_id, details) ' +
        'VALUES ($1, $2, $3, $4, $5::jsonb)',
        [actorId, 'venue.' + input.outcome, 'venue', venueId, JSON.stringify({ businessId: venue.business_id, reason })],
      );
      return updated.rows[0];
    });
  }


  async listCommunityReports(status?: string) {
    if (status && !['pending', 'resolved', 'dismissed'].includes(status)) {
      throw new BadRequestException('Trạng thái báo cáo không hợp lệ');
    }
    const result = await this.database.query(
      'SELECT r.id, r.game_id, r.reason, r.status, r.created_at, r.resolution_note, ' +
      'g.starts_at, g.status AS game_status, u.id AS reporter_id, u.full_name AS reporter_name ' +
      'FROM community_reports r JOIN community_games g ON g.id = r.game_id ' +
      'JOIN user_accounts u ON u.id = r.reporter_id ' +
      'WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at ASC LIMIT 200',
      [status ?? null],
    );
    return result.rows;
  }

  async reviewCommunityReport(reportId: string, actorId: string, input: ReviewReportDto) {
    return this.database.transaction(async (client) => {
      const current = await client.query<{ id: string; game_id: string }>(
        "SELECT id, game_id FROM community_reports WHERE id = $1 AND status = 'pending' FOR UPDATE",
        [reportId],
      );
      if (!current.rows[0]) throw new NotFoundException('Không tìm thấy báo cáo đang chờ xử lý');
      const updated = await client.query(
        'UPDATE community_reports SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), ' +
        'resolution_note = $4 WHERE id = $1 RETURNING id, game_id, status, resolution_note, reviewed_at',
        [reportId, input.outcome, actorId, input.resolutionNote?.trim() || null],
      );
      if (input.outcome === 'resolved') {
        await client.query(
          "UPDATE community_games SET status = 'closed', updated_at = now() WHERE id = $1 AND status IN ('open', 'full')",
          [current.rows[0].game_id],
        );
      }
      await client.query(
        "INSERT INTO admin_audit_log (actor_user_id, action, entity_type, entity_id, details) " +
        "VALUES ($1, $2, 'community_report', $3, $4::jsonb)",
        [actorId, 'report.' + input.outcome, reportId, JSON.stringify({ note: input.resolutionNote?.trim() || null })],
      );
      return updated.rows[0];
    });
  }


  async listAuditLog() {
    const result = await this.database.query(
      'SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.created_at, u.email AS actor_email, u.full_name AS actor_name ' +
      'FROM admin_audit_log l LEFT JOIN user_accounts u ON u.id = l.actor_user_id ORDER BY l.created_at DESC LIMIT 200',
    );
    return result.rows;
  }

  async dashboard() {
    const [result, trend] = await Promise.all([this.database.query(
      'SELECT ' +
      '(SELECT count(*)::int FROM businesses) AS businesses_total, ' +
      "(SELECT count(*)::int FROM businesses WHERE status = 'pending_review') AS businesses_pending, " +
      "(SELECT count(*)::int FROM businesses WHERE status = 'approved') AS businesses_approved, " +
      '(SELECT count(*)::int FROM venues) AS venues_total, ' +
      "(SELECT count(*)::int FROM venues WHERE status = 'pending_review') AS venues_pending, " +
      "(SELECT count(*)::int FROM venues WHERE status = 'approved') AS venues_approved, " +
      '(SELECT count(*)::int FROM bookings) AS bookings_total, ' +
      "(SELECT count(*)::int FROM bookings WHERE status = 'confirmed') AS bookings_confirmed, " +
      "(SELECT count(*)::int FROM bookings WHERE status = 'pending_payment') AS bookings_pending_payment, " +
      "(SELECT COALESCE(sum(quoted_total), 0) FROM bookings WHERE status IN ('confirmed', 'completed')) AS booked_value_vnd, " +
      "(SELECT COALESCE(sum(amount), 0) FROM booking_payments WHERE status = 'succeeded') AS demo_paid_vnd",
    ), this.database.query(
      'WITH month_series AS (' +
      "SELECT generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') AS month_start" +
      ') SELECT to_char(m.month_start, \'YYYY-MM\') AS month, count(b.id)::int AS bookings_total, ' +
      "COALESCE(sum(b.quoted_total) FILTER (WHERE b.status IN ('confirmed', 'completed')), 0)::bigint AS booked_value_vnd " +
      'FROM month_series m LEFT JOIN bookings b ON b.created_at >= m.month_start AND b.created_at < m.month_start + interval \'1 month\' ' +
      'GROUP BY m.month_start ORDER BY m.month_start',
    )]);
    return { ...result.rows[0], booking_trend: trend.rows };
  }

  async listSports() {
    const result = await this.database.query(
      'SELECT id, code, name, active, created_at FROM sports ORDER BY name',
    );
    return result.rows;
  }

  async createSport(input: CreateSportDto) {
    try {
      const result = await this.database.query(
        'INSERT INTO sports (code, name) VALUES ($1, $2) RETURNING id, code, name, active, created_at',
        [input.code.trim(), input.name.trim()],
      );
      return result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new BadRequestException('Mã môn thể thao đã tồn tại');
      }
      throw error;
    }
  }

  async updateSport(sportId: string, input: UpdateSportDto) {
    const result = await this.database.query(
      'UPDATE sports SET name = COALESCE($2, name), active = COALESCE($3, active) ' +
      'WHERE id = $1 RETURNING id, code, name, active',
      [sportId, input.name?.trim() ?? null, input.active ?? null],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy môn thể thao');
    return result.rows[0];
  }

  async listUsers(query?: string) {
    if (query && query.length > 120) throw new BadRequestException('Từ khóa tìm kiếm quá dài');
    const result = await this.database.query(
      'SELECT id, email, phone, full_name, platform_role, active, created_at ' +
      'FROM user_accounts WHERE ($1::text IS NULL OR full_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) ' +
      'ORDER BY created_at DESC LIMIT 100',
      [query ? '%' + query.trim() + '%' : null],
    );
    return result.rows;
  }

  async setUserActive(userId: string, actorId: string, input: UpdateUserActiveDto) {
    if (userId === actorId && !input.active) {
      throw new BadRequestException('Không thể tạm khóa chính tài khoản admin đang đăng nhập');
    }
    return this.database.transaction(async (client) => {
      const current = await client.query<{ id: string; platform_role: string; active: boolean }>(
        'SELECT id, platform_role, active FROM user_accounts WHERE id = $1 FOR UPDATE',
        [userId],
      );
      const account = current.rows[0];
      if (!account) throw new NotFoundException('Không tìm thấy người dùng');
      if (account.platform_role === 'platform_admin' && account.active && !input.active) {
        const admins = await client.query<{ id: string }>(
          "SELECT id FROM user_accounts WHERE platform_role = 'platform_admin' AND active = true ORDER BY id FOR UPDATE",
        );
        if (admins.rows.length <= 1) throw new BadRequestException('Không thể khóa admin hoạt động cuối cùng');
      }
      const updated = await client.query(
        'UPDATE user_accounts SET active = $2, updated_at = now() WHERE id = $1 ' +
        'RETURNING id, email, full_name, platform_role, active',
        [userId, input.active],
      );
      await client.query(
        "INSERT INTO admin_audit_log (actor_user_id, action, entity_type, entity_id, details) " +
        "VALUES ($1, $2, 'user', $3, $4::jsonb)",
        [actorId, input.active ? 'user.activated' : 'user.deactivated', userId, JSON.stringify({ active: input.active })],
      );
      return updated.rows[0];
    });
  }

}
