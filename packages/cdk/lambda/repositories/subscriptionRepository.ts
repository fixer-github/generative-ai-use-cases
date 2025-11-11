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
    return result.rows.map((row) => this.mapRowToSubscription(row));
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
    return result.rows.map((row) => this.mapRowToSubscription(row));
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
    return result.rows.map((row) => this.mapRowToSubscription(row));
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
    return result.rows.map((row) => this.mapRowToSubscription(row));
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
