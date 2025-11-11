/**
 * User Plan Application Repository
 * Manages CRUD operations for the user_plan_applications table
 */

import { BaseRepository } from './baseRepository';
import { UserPlanApplication } from './types';

export class UserPlanApplicationRepository extends BaseRepository {
  /**
   * ユーザプラン適用を作成する
   */
  async create(
    application: Omit<
      UserPlanApplication,
      'application_id' | 'created_at' | 'updated_at'
    >
  ): Promise<UserPlanApplication> {
    const query = `
      INSERT INTO user_plan_applications (
        user_id,
        plan_id,
        application_source,
        application_source_id,
        application_status,
        valid_from,
        valid_until
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const params = [
      application.user_id,
      application.plan_id,
      application.application_source,
      application.application_source_id || null,
      application.application_status,
      application.valid_from,
      application.valid_until || null,
    ];

    const result = await this.query<UserPlanApplication>(query, params);
    return this.mapRowToUserPlanApplication(result.rows[0]);
  }

  /**
   * 適用IDでユーザプラン適用を取得する
   */
  async findById(applicationId: string): Promise<UserPlanApplication | null> {
    const query =
      'SELECT * FROM user_plan_applications WHERE application_id = $1';
    const result = await this.query<UserPlanApplication>(query, [
      applicationId,
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToUserPlanApplication(result.rows[0]);
  }

  /**
   * ユーザIDでプラン適用一覧を取得する
   */
  async findByUserId(userId: string): Promise<UserPlanApplication[]> {
    const query = `
      SELECT * FROM user_plan_applications
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.query<UserPlanApplication>(query, [userId]);
    return result.rows.map((row) => this.mapRowToUserPlanApplication(row));
  }

  /**
   * ユーザの有効なプラン適用を取得する
   */
  async findActiveByUserId(userId: string): Promise<UserPlanApplication[]> {
    const query = `
      SELECT * FROM user_plan_applications
      WHERE user_id = $1 AND application_status = 'active'
      ORDER BY created_at DESC
    `;

    const result = await this.query<UserPlanApplication>(query, [userId]);
    return result.rows.map((row) => this.mapRowToUserPlanApplication(row));
  }

  /**
   * 適用ソースIDでプラン適用を取得する
   */
  async findByApplicationSourceId(
    sourceId: string
  ): Promise<UserPlanApplication[]> {
    const query = `
      SELECT * FROM user_plan_applications
      WHERE application_source_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.query<UserPlanApplication>(query, [sourceId]);
    return result.rows.map((row) => this.mapRowToUserPlanApplication(row));
  }

  /**
   * 期限切れ間近のプラン適用一覧を取得する
   */
  async findExpiringSoon(thresholdDate: Date): Promise<UserPlanApplication[]> {
    const query = `
      SELECT * FROM user_plan_applications
      WHERE application_status IN ('active', 'scheduled_termination')
        AND valid_until IS NOT NULL
        AND valid_until <= $1
      ORDER BY valid_until ASC
    `;

    const result = await this.query<UserPlanApplication>(query, [
      thresholdDate,
    ]);
    return result.rows.map((row) => this.mapRowToUserPlanApplication(row));
  }

  /**
   * 解約予定のプラン適用一覧を取得する
   */
  async findScheduledTermination(): Promise<UserPlanApplication[]> {
    const query = `
      SELECT * FROM user_plan_applications
      WHERE application_status = 'scheduled_termination'
      ORDER BY valid_until ASC
    `;

    const result = await this.query<UserPlanApplication>(query);
    return result.rows.map((row) => this.mapRowToUserPlanApplication(row));
  }

  /**
   * プラン適用を更新する
   */
  async update(
    applicationId: string,
    updates: Partial<
      Omit<UserPlanApplication, 'application_id' | 'created_at' | 'updated_at'>
    >
  ): Promise<UserPlanApplication | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.application_status !== undefined) {
      fields.push(`application_status = $${paramIndex++}`);
      params.push(updates.application_status);
    }

    if (updates.valid_from !== undefined) {
      fields.push(`valid_from = $${paramIndex++}`);
      params.push(updates.valid_from);
    }

    if (updates.valid_until !== undefined) {
      fields.push(`valid_until = $${paramIndex++}`);
      params.push(updates.valid_until);
    }

    if (fields.length === 0) {
      return this.findById(applicationId);
    }

    params.push(applicationId);

    const query = `
      UPDATE user_plan_applications
      SET ${fields.join(', ')}
      WHERE application_id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.query<UserPlanApplication>(query, params);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToUserPlanApplication(result.rows[0]);
  }

  /**
   * プラン適用を解約予定としてマークする
   */
  async scheduleTermination(
    applicationId: string
  ): Promise<UserPlanApplication | null> {
    return this.update(applicationId, {
      application_status: 'scheduled_termination',
    });
  }

  /**
   * プラン適用を期限切れとしてマークする
   */
  async expire(applicationId: string): Promise<UserPlanApplication | null> {
    return this.update(applicationId, {
      application_status: 'expired',
    });
  }

  /**
   * プラン適用の期限を延長する
   */
  async extendValidity(
    applicationId: string,
    newValidUntil: Date
  ): Promise<UserPlanApplication | null> {
    return this.update(applicationId, {
      valid_until: newValidUntil,
    });
  }

  /**
   * ユーザのサブスクリプション経由のプラン適用を取得する
   */
  async findSubscriptionApplicationByUserId(
    userId: string
  ): Promise<UserPlanApplication[]> {
    const query = `
      SELECT * FROM user_plan_applications
      WHERE user_id = $1
        AND application_source = 'subscription'
        AND application_status IN ('active', 'scheduled_termination')
      ORDER BY created_at DESC
    `;

    const result = await this.query<UserPlanApplication>(query, [userId]);
    return result.rows.map((row) => this.mapRowToUserPlanApplication(row));
  }

  /**
   * データベースの行をUserPlanApplicationオブジェクトにマッピングする
   */
  private mapRowToUserPlanApplication(row: any): UserPlanApplication {
    return {
      application_id: row.application_id,
      user_id: row.user_id,
      plan_id: row.plan_id,
      application_source: row.application_source,
      application_source_id: row.application_source_id,
      application_status: row.application_status,
      valid_from: new Date(row.valid_from),
      valid_until: row.valid_until ? new Date(row.valid_until) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
