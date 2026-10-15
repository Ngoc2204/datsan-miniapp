import { Injectable } from '@nestjs/common';
import { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

export interface SportDto {
  id: string;
  code: string;
  name: string;
}

interface SportRow extends QueryResultRow {
  id: string;
  code: string;
  name: string;
}

@Injectable()
export class SportsService {
  constructor(private readonly database: DatabaseService) {}

  async listActive(): Promise<SportDto[]> {
    const result = await this.database.query<SportRow>(
      'SELECT id, code, name FROM sports WHERE active = true ORDER BY name ASC',
    );

    return result.rows;
  }
}
