import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateGameDto, GameQueryDto, ReportGameDto } from './community.dto';

@Injectable()
export class CommunityService {
  constructor(private readonly database: DatabaseService) {}

  async list(query: GameQueryDto) {
    const result = await this.database.query(
      "SELECT g.id, g.starts_at, g.target_players, g.note, g.status, g.created_at, " +
      "v.id AS venue_id, v.name AS venue_name, v.address, s.code AS sport_code, s.name AS sport_name, " +
      "u.id AS organizer_id, u.full_name AS organizer_name, count(p.user_id) FILTER (WHERE p.status = 'active')::int AS joined_players, " +
      "greatest(g.target_players - count(p.user_id) FILTER (WHERE p.status = 'active'), 0)::int AS remaining_players " +
      "FROM community_games g JOIN venues v ON v.id = g.venue_id " +
      "JOIN businesses b ON b.id = v.business_id " +
      "JOIN sports s ON s.id = g.sport_id AND s.active = true " +
      "JOIN user_accounts u ON u.id = g.organizer_id " +
      "LEFT JOIN community_game_participants p ON p.game_id = g.id " +
      "WHERE g.status IN ('open', 'full') AND g.starts_at > now() " +
      "AND v.status = 'approved' AND b.status = 'approved' " +
      "AND ($1::text IS NULL OR s.code = $1) AND ($2::uuid IS NULL OR v.id = $2) " +
      "AND ($3::timestamptz IS NULL OR g.starts_at >= $3) " +
      "GROUP BY g.id, v.id, s.id, u.id ORDER BY g.starts_at LIMIT 100",
      [query.sport ?? null, query.venueId ?? null, query.startsAfter ?? null],
    );
    return result.rows;
  }

  async listMine(userId: string) {
    const result = await this.database.query(
      "SELECT g.id, g.starts_at, g.target_players, g.note, g.status, v.id AS venue_id, v.name AS venue_name, v.address, s.code AS sport_code, s.name AS sport_name, " +
      "g.organizer_id, u.full_name AS organizer_name, count(p2.user_id) FILTER (WHERE p2.status = 'active')::int AS joined_players, " +
      "greatest(g.target_players - count(p2.user_id) FILTER (WHERE p2.status = 'active'), 0)::int AS remaining_players " +
      'FROM community_game_participants mine JOIN community_games g ON g.id = mine.game_id ' +
      'JOIN venues v ON v.id = g.venue_id JOIN sports s ON s.id = g.sport_id JOIN user_accounts u ON u.id = g.organizer_id ' +
      'LEFT JOIN community_game_participants p2 ON p2.game_id = g.id ' +
      "WHERE mine.user_id = $1 AND mine.status = 'active' AND g.starts_at > now() AND g.status IN ('open', 'full') " +
      'GROUP BY g.id, v.id, s.id, u.id ORDER BY g.starts_at LIMIT 100',
      [userId],
    );
    return result.rows;
  }

  async get(gameId: string) {
    const result = await this.database.query(
      "SELECT g.id, g.starts_at, g.target_players, g.note, g.status, g.created_at, " +
      "v.id AS venue_id, v.name AS venue_name, v.address, s.code AS sport_code, s.name AS sport_name, " +
      "u.id AS organizer_id, u.full_name AS organizer_name, " +
      "count(p.user_id) FILTER (WHERE p.status = 'active')::int AS joined_players, " +
      "greatest(g.target_players - count(p.user_id) FILTER (WHERE p.status = 'active'), 0)::int AS remaining_players, " +
      "COALESCE(json_agg(json_build_object('userId', pu.id, 'fullName', pu.full_name, 'joinedAt', p.joined_at) " +
      "ORDER BY p.joined_at) FILTER (WHERE p.status = 'active'), '[]'::json) AS participants " +
      "FROM community_games g JOIN venues v ON v.id = g.venue_id JOIN businesses b ON b.id = v.business_id " +
      "JOIN sports s ON s.id = g.sport_id JOIN user_accounts u ON u.id = g.organizer_id " +
      "LEFT JOIN community_game_participants p ON p.game_id = g.id " +
      "LEFT JOIN user_accounts pu ON pu.id = p.user_id " +
      "WHERE g.id = $1 AND v.status = 'approved' AND b.status = 'approved' " +
      "GROUP BY g.id, v.id, s.id, u.id",
      [gameId],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy kèo');
    return result.rows[0];
  }

  async create(userId: string, input: CreateGameDto) {
    const start = new Date(input.startsAt);
    if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
      throw new BadRequestException('Thời gian kèo phải ở phía trước');
    }
    const gameId = await this.database.transaction(async (client) => {
      const venue = await client.query<{ id: string; sport_id: string }>(
        "SELECT v.id, vs.sport_id FROM venues v JOIN businesses b ON b.id = v.business_id " +
        "JOIN venue_sports vs ON vs.business_id = v.business_id AND vs.venue_id = v.id " +
        "JOIN sports s ON s.id = vs.sport_id AND s.active = true " +
        "WHERE v.id = $1 AND s.code = $2 AND v.status = 'approved' AND b.status = 'approved'",
        [input.venueId, input.sportCode],
      );
      if (!venue.rows[0]) throw new BadRequestException('Địa điểm chưa được duyệt cho môn thể thao này');
      const game = await client.query<{ id: string }>(
        "INSERT INTO community_games (organizer_id, venue_id, sport_id, starts_at, target_players, note) " +
        "VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [userId, input.venueId, venue.rows[0].sport_id, start, input.targetPlayers, input.note?.trim() || null],
      );
      await client.query(
        "INSERT INTO community_game_participants (game_id, user_id, status) VALUES ($1, $2, 'active')",
        [game.rows[0].id, userId],
      );
      return game.rows[0].id;
    });
    return this.get(gameId);
  }

  async join(userId: string, gameId: string) {
    const outcome = await this.database.transaction(async (client) => {
      const result = await client.query<{ id: string; status: string; target_players: number; starts_at: Date }>(
        'SELECT id, status, target_players, starts_at FROM community_games WHERE id = $1 FOR UPDATE',
        [gameId],
      );
      const game = result.rows[0];
      if (!game) throw new NotFoundException('Không tìm thấy kèo');
      if (game.starts_at.getTime() <= Date.now()) throw new BadRequestException('Kèo đã bắt đầu');
      if (game.status !== 'open') throw new ConflictException('Kèo không còn nhận người tham gia');
      const existing = await client.query<{ status: string }>(
        'SELECT status FROM community_game_participants WHERE game_id = $1 AND user_id = $2',
        [gameId, userId],
      );
      if (existing.rows[0]?.status === 'active') throw new ConflictException('Bạn đã tham gia kèo này');
      const count = await client.query<{ joined: number }>(
        "SELECT count(*)::int AS joined FROM community_game_participants WHERE game_id = $1 AND status = 'active'",
        [gameId],
      );
      if (count.rows[0].joined >= game.target_players) {
        await client.query("UPDATE community_games SET status = 'full', updated_at = now() WHERE id = $1", [gameId]);
        return { isFull: true, status: 'full' as const, joinedPlayers: count.rows[0].joined };
      }
      const inserted = await client.query(
        "INSERT INTO community_game_participants (game_id, user_id, status, joined_at) " +
        "VALUES ($1, $2, 'active', now()) ON CONFLICT (game_id, user_id) " +
        "DO UPDATE SET status = 'active', joined_at = now() WHERE community_game_participants.status = 'left' " +
        'RETURNING user_id',
        [gameId, userId],
      );
      if (inserted.rowCount !== 1) throw new ConflictException('Bạn đã tham gia kèo này');
      const nextCount = count.rows[0].joined + 1;
      if (nextCount >= game.target_players) {
        await client.query("UPDATE community_games SET status = 'full', updated_at = now() WHERE id = $1", [gameId]);
      }
      return { isFull: false, status: nextCount >= game.target_players ? 'full' as const : 'open' as const, joinedPlayers: nextCount };
    });
    if (outcome.isFull) throw new ConflictException('Kèo đã đủ người');
    return { gameId, status: outcome.status, joinedPlayers: outcome.joinedPlayers };
  }

  async leave(userId: string, gameId: string) {
    return this.database.transaction(async (client) => {
      const result = await client.query<{ status: string; starts_at: Date; organizer_id: string }>(
        'SELECT status, starts_at, organizer_id FROM community_games WHERE id = $1 FOR UPDATE',
        [gameId],
      );
      const game = result.rows[0];
      if (!game) throw new NotFoundException('Không tìm thấy kèo');
      if (game.starts_at.getTime() <= Date.now()) throw new BadRequestException('Kèo đã bắt đầu');
      if (game.organizer_id === userId) throw new BadRequestException('Người tổ chức cần đóng kèo thay vì rời kèo');
      if (game.status === 'closed' || game.status === 'cancelled') {
        throw new BadRequestException('Kèo đã đóng');
      }
      const update = await client.query(
        "UPDATE community_game_participants SET status = 'left' WHERE game_id = $1 AND user_id = $2 AND status = 'active' RETURNING user_id",
        [gameId, userId],
      );
      if (update.rowCount !== 1) throw new NotFoundException('Bạn chưa tham gia kèo này');
      await client.query(
        "UPDATE community_games SET status = 'open', updated_at = now() WHERE id = $1 AND status IN ('open', 'full')",
        [gameId],
      );
      const count = await client.query<{ joined: number }>(
        "SELECT count(*)::int AS joined FROM community_game_participants WHERE game_id = $1 AND status = 'active'",
        [gameId],
      );
      return { gameId, status: 'open', joinedPlayers: count.rows[0].joined };
    });
  }

  async close(userId: string, gameId: string) {
    const result = await this.database.query(
      "UPDATE community_games SET status = 'closed', updated_at = now() " +
      "WHERE id = $1 AND organizer_id = $2 AND status IN ('open', 'full') RETURNING id, status",
      [gameId, userId],
    );
    if (result.rowCount !== 1) throw new NotFoundException('Không tìm thấy kèo đang mở do bạn tổ chức');
    return result.rows[0];
  }

  async report(userId: string, gameId: string, input: ReportGameDto) {
    try {
      const result = await this.database.query(
        "INSERT INTO community_reports (game_id, reporter_id, reason) " +
        "SELECT g.id, $2, $3 FROM community_games g JOIN venues v ON v.id = g.venue_id " +
        "WHERE g.id = $1 AND v.status = 'approved' RETURNING id, status",
        [gameId, userId, input.reason.trim()],
      );
      if (!result.rows[0]) throw new NotFoundException('Không tìm thấy kèo');
      return result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Bạn đã báo cáo kèo này');
      }
      throw error;
    }
  }

  async reviewReport(reportId: string, actorId: string, outcome: 'resolved' | 'dismissed', note?: string) {
    const result = await this.database.query(
      "UPDATE community_reports SET status = $2, reviewed_by_user_id = $3, reviewed_at = now(), resolution_note = $4 " +
      "WHERE id = $1 AND status = 'pending' RETURNING id, game_id, status, resolution_note, reviewed_at",
      [reportId, outcome, actorId, note?.trim() || null],
    );
    if (!result.rows[0]) throw new NotFoundException('Không tìm thấy báo cáo đang chờ xử lý');
    await this.database.query(
      "INSERT INTO admin_audit_log (actor_user_id, action, entity_type, entity_id, details) " +
      "VALUES ($1, $2, 'community_report', $3, $4::jsonb)",
      [actorId, 'report.' + outcome, reportId, JSON.stringify({ note: note?.trim() || null })],
    );
    return result.rows[0];
  }

  async listReports(status?: string) {
    if (status && !['pending', 'resolved', 'dismissed'].includes(status)) {
      throw new BadRequestException('Trạng thái báo cáo không hợp lệ');
    }
    const result = await this.database.query(
      'SELECT r.id, r.game_id, r.reason, r.status, r.created_at, g.starts_at, g.status AS game_status, ' +
      'u.id AS reporter_id, u.full_name AS reporter_name FROM community_reports r ' +
      'JOIN community_games g ON g.id = r.game_id JOIN user_accounts u ON u.id = r.reporter_id ' +
      'WHERE ($1::text IS NULL OR r.status = $1) ORDER BY r.created_at ASC LIMIT 200',
      [status ?? null],
    );
    return result.rows;
  }
}
