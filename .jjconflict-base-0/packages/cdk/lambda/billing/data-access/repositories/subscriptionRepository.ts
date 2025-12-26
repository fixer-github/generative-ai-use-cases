/**
 * Subscription Repository
 * Manages CRUD operations for the subscriptions table
 */

import { BaseRepository } from './baseRepository';
import { Subscription } from './types';

export class SubscriptionRepository extends BaseRepository {
  /**
   * サブスクリプションを作成する
   */
  async create(
    subscription: Omit<Subscription, 'subscription_id' | 'created_at' | 'updated_at'>
  ): Promise<Subscription> {
    const query = `
      INSERT INTO subscriptions (
        user_id,
        plan_id,
        platform_type,
        platform_subscription_id,
        subscription_status,
        current_period_start,
        current_period_end,
        cancel_at_period_end
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const params = [
      subscription.user_id,
      subscription.plan_id,
      subscription.platform_type,
      subscription.platform_subscription_id,
      subscription.subscription_status,
      subscription.current_period_start,
      subscription.current_period_end,
      subscription.cancel_at_period_end,
    ];

    const result = await this.query<Subscription>(query, params);
    return this.mapRowToSubscription(result.rows[0]);
  }

  /**
   * サブスクリプションIDでサブスクリプションを取得する
   */
  async findById(subscriptionId: string): Promise<Subscription | null> {
    const query = 'SELECT * FROM subscriptions WHERE subscription_id = $1';
    const result = await this.query<Subscription>(query, [subscriptionId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToSubscription(result.rows[0]);
  }

  /**
   * プラットフォームサブスクリプションIDでサブスクリプションを取得する
   */
  async findByPlatformSubscriptionId(
    platformSubscriptionId: string
  ): Promise<Subscription | null> {
    const query =
      'SELECT * FROM subscriptions WHERE platform_subscription_id = $1';
    const result = await this.query<Subscription>(query, [
      platformSubscriptionId,
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToSubscription(result.rows[0]);
  }

  /**
   * ユーザIDでサブスクリプション一覧を取得する
   */
  async findByUserId(userId: string): Promise<Subscription[]> {
    const query = `
      SELECT * FROM subscriptions
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.query<Subscription>(query, [userId]);
    return result.rows.map((row: any) => this.mapRowToSubscription(row));
  }

  /**
   * ユーザIDと状態でサブスクリプションを取得する
   */
  async findByUserIdAndStatus(
    userId: string,
    status: Subscription['subscription_status']
  ): Promise<Subscription[]> {
    const query = `
      SELECT * FROM subscriptions
      WHERE user_id = $1 AND subscription_status = $2
      ORDER BY created_at DESC
    `;

    const result = await this.query<Subscription>(query, [userId, status]);
    return result.rows.map((row: any) => this.mapRowToSubscription(row));
  }

  /**
   * ユーザの有効なサブスクリプション一覧を取得する
   */
  async findActiveByUserId(userId: string): Promise<Subscription[]> {
    return this.findByUserIdAndStatus(userId, 'active');
  }

  /**
   * 検証保留中のサブスクリプション一覧を取得する
   */
  async findPendingVerification(): Promise<Subscription[]> {
    const query = `
      SELECT * FROM subscriptions
      WHERE subscription_status = 'pending_verification'
      ORDER BY created_at DESC
    `;

    const result = await this.query<Subscription>(query);
    return result.rows.map((row: any) => this.mapRowToSubscription(row));
  }

  /**
   * 期限切れ間近のサブスクリプション一覧を取得する
   */
  async findExpiringSoon(thresholdDate: Date): Promise<Subscription[]> {
    const query = `
      SELECT * FROM subscriptions
      WHERE subscription_status = 'active'
        AND current_period_end <= $1
      ORDER BY current_period_end ASC
    `;

    const result = await this.query<Subscription>(query, [thresholdDate]);
    return result.rows.map((row: any) => this.mapRowToSubscription(row));
  }

  /**
   * サブスクリプションを更新する
   */
  async update(
    subscriptionId: string,
    updates: Partial<
      Omit<Subscription, 'subscription_id' | 'created_at' | 'updated_at'>
    >
  ): Promise<Subscription | null> {
    const fields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.subscription_status !== undefined) {
      fields.push(`subscription_status = $${paramIndex++}`);
      params.push(updates.subscription_status);
    }

    if (updates.current_period_start !== undefined) {
      fields.push(`current_period_start = $${paramIndex++}`);
      params.push(updates.current_period_start);
    }

    if (updates.current_period_end !== undefined) {
      fields.push(`current_period_end = $${paramIndex++}`);
      params.push(updates.current_period_end);
    }

    if (updates.cancel_at_period_end !== undefined) {
      fields.push(`cancel_at_period_end = $${paramIndex++}`);
      params.push(updates.cancel_at_period_end);
    }

    if (updates.plan_id !== undefined) {
      fields.push(`plan_id = $${paramIndex++}`);
      params.push(updates.plan_id);
    }

    if (fields.length === 0) {
      return this.findById(subscriptionId);
    }

    params.push(subscriptionId);

    const query = `
      UPDATE subscriptions
      SET ${fields.join(', ')}
      WHERE subscription_id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.query<Subscription>(query, params);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToSubscription(result.rows[0]);
  }

  /**
   * サブスクリプションをキャンセル状態に更新する
   */
  async cancel(subscriptionId: string): Promise<Subscription | null> {
    return this.update(subscriptionId, {
      subscription_status: 'canceled',
    });
  }

  /**
   * サブスクリプションを期限終了時キャンセルとしてマークする
   */
  async scheduleCancel(subscriptionId: string): Promise<Subscription | null> {
    return this.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }

  /**
   * サブスクリプションの期限を延長する
   */
  async extendPeriod(
    subscriptionId: string,
    newPeriodStart: Date,
    newPeriodEnd: Date
  ): Promise<Subscription | null> {
    return this.update(subscriptionId, {
      current_period_start: newPeriodStart,
      current_period_end: newPeriodEnd,
    });
  }

  /**
   * 管理者向け: サブスクリプション統計情報を取得する
   */
  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPlatform: Record<string, Record<string, number>>;
    byPlan: Array<{
      planId: string;
      planName: string;
      count: number;
    }>;
  }> {
    // ステータス別の集計
    const statusQuery = `
      SELECT subscription_status, COUNT(*) as count
      FROM subscriptions
      GROUP BY subscription_status
    `;
    const statusResult = await this.query<{ subscription_status: string; count: string }>(statusQuery);

    const byStatus: Record<string, number> = {};
    let total = 0;
    for (const row of statusResult.rows) {
      const count = parseInt(row.count, 10);
      byStatus[row.subscription_status] = count;
      total += count;
    }

    // プラットフォーム × ステータス別の集計
    const platformQuery = `
      SELECT platform_type, subscription_status, COUNT(*) as count
      FROM subscriptions
      GROUP BY platform_type, subscription_status
    `;
    const platformResult = await this.query<{
      platform_type: string;
      subscription_status: string;
      count: string;
    }>(platformQuery);

    const byPlatform: Record<string, Record<string, number>> = {
      stripe: {},
      apple: {},
      google: {},
    };
    for (const row of platformResult.rows) {
      if (!byPlatform[row.platform_type]) {
        byPlatform[row.platform_type] = {};
      }
      byPlatform[row.platform_type][row.subscription_status] = parseInt(row.count, 10);
    }

    // プラン別の集計
    const planQuery = `
      SELECT s.plan_id, p.display_name, COUNT(*) as count
      FROM subscriptions s
      LEFT JOIN plans p ON s.plan_id = p.plan_id
      WHERE s.subscription_status = 'active'
      GROUP BY s.plan_id, p.display_name
      ORDER BY count DESC
    `;
    const planResult = await this.query<{
      plan_id: string;
      display_name: string;
      count: string;
    }>(planQuery);

    const byPlan = planResult.rows.map((row: any) => ({
      planId: row.plan_id,
      planName: row.display_name || 'Unknown Plan',
      count: parseInt(row.count, 10),
    }));

    return {
      total,
      byStatus,
      byPlatform,
      byPlan,
    };
  }

  /**
   * 管理者向け: サブスクリプション一覧を検索・フィルタして取得する
   */
  async findAllForAdmin(options: {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    subscriptionId?: string;
    userId?: string;
    userName?: string;
    platformType?: string;
    platformSubscriptionId?: string;
    status?: string;
    planId?: string;
    periodStartFrom?: Date;
    periodStartTo?: Date;
    createdAtFrom?: Date;
    createdAtTo?: Date;
  } = {}): Promise<{
    subscriptions: Array<Subscription & { user_name?: string; plan_name?: string }>;
    totalCount: number;
  }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // フィルタ条件の構築
    if (options.subscriptionId) {
      conditions.push(`s.subscription_id::text ILIKE $${paramIndex++}`);
      params.push(`%${options.subscriptionId}%`);
    }

    if (options.userId) {
      conditions.push(`s.user_id ILIKE $${paramIndex++}`);
      params.push(`%${options.userId}%`);
    }

    if (options.platformType) {
      conditions.push(`s.platform_type = $${paramIndex++}`);
      params.push(options.platformType);
    }

    if (options.platformSubscriptionId) {
      conditions.push(`s.platform_subscription_id ILIKE $${paramIndex++}`);
      params.push(`%${options.platformSubscriptionId}%`);
    }

    if (options.status) {
      conditions.push(`s.subscription_status = $${paramIndex++}`);
      params.push(options.status);
    }

    if (options.planId) {
      conditions.push(`s.plan_id = $${paramIndex++}`);
      params.push(options.planId);
    }

    if (options.periodStartFrom) {
      conditions.push(`s.current_period_start >= $${paramIndex++}`);
      params.push(options.periodStartFrom);
    }

    if (options.periodStartTo) {
      conditions.push(`s.current_period_start <= $${paramIndex++}`);
      params.push(options.periodStartTo);
    }

    if (options.createdAtFrom) {
      conditions.push(`s.created_at >= $${paramIndex++}`);
      params.push(options.createdAtFrom);
    }

    if (options.createdAtTo) {
      conditions.push(`s.created_at <= $${paramIndex++}`);
      params.push(options.createdAtTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // ソート条件
    const sortBy = options.sortBy || 'created_at';
    const sortOrder = options.sortOrder || 'desc';
    const orderByClause = `ORDER BY s.${sortBy} ${sortOrder.toUpperCase()}`;

    // 総件数を取得
    const countQuery = `
      SELECT COUNT(*) as total
      FROM subscriptions s
      ${whereClause}
    `;
    const countResult = await this.query<{ total: string }>(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].total, 10);

    // ページネーション
    const page = options.page || 1;
    const limit = Math.min(options.limit || 20, 100);
    const offset = (page - 1) * limit;

    // データ取得（JOINでプラン名も取得）
    const dataQuery = `
      SELECT
        s.*,
        p.display_name as plan_name
      FROM subscriptions s
      LEFT JOIN plans p ON s.plan_id = p.plan_id
      ${whereClause}
      ${orderByClause}
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    params.push(limit, offset);

    const dataResult = await this.query<any>(dataQuery, params);
    const subscriptions = dataResult.rows.map((row: any) => ({
      ...this.mapRowToSubscription(row),
      plan_name: row.plan_name,
    }));

    return {
      subscriptions,
      totalCount,
    };
  }

  /**
   * 管理者向け: サブスクリプション詳細情報を取得する（プラン情報とユーザ情報を含む）
   */
  async findByIdWithDetails(subscriptionId: string): Promise<{
    subscription: Subscription;
    plan: any;
  } | null> {
    const query = `
      SELECT
        s.*,
        p.plan_id,
        p.internal_name,
        p.display_name as plan_display_name,
        p.platform_type as plan_platform_type,
        p.platform_product_id,
        p.permissions,
        p.status as plan_status
      FROM subscriptions s
      LEFT JOIN plans p ON s.plan_id = p.plan_id
      WHERE s.subscription_id = $1
    `;

    const result = await this.query<any>(query, [subscriptionId]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    return {
      subscription: this.mapRowToSubscription(row),
      plan: {
        plan_id: row.plan_id,
        internal_name: row.internal_name,
        display_name: row.plan_display_name,
        platform_type: row.plan_platform_type,
        platform_product_id: row.platform_product_id,
        permissions: typeof row.permissions === 'string'
          ? JSON.parse(row.permissions)
          : row.permissions,
        status: row.plan_status,
      },
    };
  }

  /**
   * データベースの行をSubscriptionオブジェクトにマッピングする
   */
  private mapRowToSubscription(row: any): Subscription {
    return {
      subscription_id: row.subscription_id,
      user_id: row.user_id,
      plan_id: row.plan_id,
      platform_type: row.platform_type,
      platform_subscription_id: row.platform_subscription_id,
      subscription_status: row.subscription_status,
      current_period_start: new Date(row.current_period_start),
      current_period_end: new Date(row.current_period_end),
      cancel_at_period_end: row.cancel_at_period_end,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
