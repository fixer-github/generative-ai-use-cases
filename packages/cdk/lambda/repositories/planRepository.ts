/**
 * Plan Repository
 * Manages CRUD operations for the plans table
 */

import { BaseRepository } from './baseRepository';
import { Plan } from './types';

export class PlanRepository extends BaseRepository {
  /**
   * プランを作成する
   */
  async create(plan: Omit<Plan, 'plan_id' | 'created_at' | 'updated_at'>): Promise<Plan> {
    const query = `
      INSERT INTO plans (
        internal_name,
        display_name,
        description,
        platform_type,
        platform_product_id,
        permissions,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const params = [
      plan.internal_name,
      plan.display_name,
      plan.description || null,
      plan.platform_type,
      plan.platform_product_id || null,
      JSON.stringify(plan.permissions),
      plan.status,
    ];

    const result = await this.query<Plan>(query, params);
    return this.mapRowToPlan(result.rows[0]);
  }

  /**
   * プランIDでプランを取得する
   */
  async findById(planId: string): Promise<Plan | null> {
    const query = 'SELECT * FROM plans WHERE plan_id = $1';
    const result = await this.query<Plan>(query, [planId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToPlan(result.rows[0]);
  }

  /**
   * 内部名称でプランを取得する
   */
  async findByInternalName(internalName: string): Promise<Plan | null> {
    const query = 'SELECT * FROM plans WHERE internal_name = $1';
    const result = await this.query<Plan>(query, [internalName]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToPlan(result.rows[0]);
  }

  /**
   * プラットフォーム商品IDでプランを取得する
   */
  async findByPlatformProductId(
    platformProductId: string
  ): Promise<Plan | null> {
    const query = 'SELECT * FROM plans WHERE platform_product_id = $1';
    const result = await this.query<Plan>(query, [platformProductId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToPlan(result.rows[0]);
  }

  /**
   * プラン一覧を取得する
   *
   * @returns すべてのプランのリスト（デフォルトでは作成日の降順）
   */
  async findAll(
    options: {
      platformType?: string;
      status?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
    } = {}
  ): Promise<Plan[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // フィルタ条件の追加
    if (options.platformType) {
      conditions.push(`platform_type = $${paramIndex++}`);
      params.push(options.platformType);
    }

    if (options.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(options.status);
    }

    if (options.search) {
      conditions.push(
        `(internal_name ILIKE $${paramIndex} OR display_name ILIKE $${paramIndex})`
      );
      params.push(`%${options.search}%`);
      paramIndex++;
    }

    // WHERE句の構築
    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // ORDER BY句の構築
    const sortBy = options.sortBy || 'created_at';
    const sortOrder =
      options.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const orderByClause = `ORDER BY ${sortBy} ${sortOrder}`;

    const query = `
      SELECT * FROM plans
      ${whereClause}
      ${orderByClause}
    `;

    const result = await this.query<Plan>(query, params);
    return result.rows.map((row) => this.mapRowToPlan(row));
  }

  /**
   * プラットフォームとステータスでプラン一覧を取得する
   */
  async findByPlatformAndStatus(
    platformType: 'stripe' | 'apple' | 'google' | 'internal',
    status: 'active' | 'closed_to_new' | 'deprecated'
  ): Promise<Plan[]> {
    const query = `
      SELECT * FROM plans
      WHERE platform_type = $1 AND status = $2
      ORDER BY created_at DESC
    `;

    const result = await this.query<Plan>(query, [platformType, status]);
    return result.rows.map((row) => this.mapRowToPlan(row));
  }

  /**
   * 新規加入可能なプラン一覧を取得する
   */
  async findActiveByPlatform(
    platformType: 'stripe' | 'apple' | 'google' | 'internal'
  ): Promise<Plan[]> {
    return this.findByPlatformAndStatus(platformType, 'active');
  }

  /**
   * プランを更新する
   */
  async update(
    planId: string,
    updates: Partial<Omit<Plan, 'plan_id' | 'created_at' | 'updated_at'>>
  ): Promise<Plan | null> {
    // 更新可能なフィールドのみを抽出
    const fields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.display_name !== undefined) {
      fields.push(`display_name = $${paramIndex++}`);
      params.push(updates.display_name);
    }

    if (updates.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      params.push(updates.description);
    }

    if (updates.permissions !== undefined) {
      fields.push(`permissions = $${paramIndex++}`);
      params.push(JSON.stringify(updates.permissions));
    }

    if (updates.status !== undefined) {
      fields.push(`status = $${paramIndex++}`);
      params.push(updates.status);
    }

    if (fields.length === 0) {
      // 更新フィールドがない場合は現在の状態を返す
      return this.findById(planId);
    }

    params.push(planId);

    const query = `
      UPDATE plans
      SET ${fields.join(', ')}
      WHERE plan_id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.query<Plan>(query, params);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToPlan(result.rows[0]);
  }

  /**
   * プランを削除する（論理削除：deprecatedに変更）
   */
  async deprecate(planId: string): Promise<Plan | null> {
    return this.update(planId, { status: 'deprecated' });
  }

  /**
   * データベースの行をPlanオブジェクトにマッピングする
   */
  private mapRowToPlan(row: any): Plan {
    return {
      plan_id: row.plan_id,
      internal_name: row.internal_name,
      display_name: row.display_name,
      description: row.description,
      platform_type: row.platform_type,
      platform_product_id: row.platform_product_id,
      permissions:
        typeof row.permissions === 'string'
          ? JSON.parse(row.permissions)
          : row.permissions,
      status: row.status,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
