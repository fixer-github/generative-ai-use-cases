/**
 * プラン変更判定ユーティリティ
 *
 * プラン変更時のupgrade/downgrade判定を価格ベースで行う共通関数を提供します。
 */

/**
 * プラン変更タイプ
 */
export type PlanChangeType = 'upgrade' | 'downgrade';

/**
 * 価格ベースでプラン変更タイプを判定
 *
 * 価格が同等以上ならばupgrade、小さければdowngradeとして判定します。
 *
 * @param currentPriceAmount 現在のプラン価格（整数、例：JPYの場合は円単位）
 * @param newPriceAmount 新しいプラン価格（整数）
 * @returns 'upgrade' または 'downgrade'
 *
 * @example
 * // Standard(1580円) → Pro(2980円) の場合
 * determineChangeTypeByPrice(1580, 2980); // 'upgrade'
 *
 * // Pro(2980円) → Standard(1580円) の場合
 * determineChangeTypeByPrice(2980, 1580); // 'downgrade'
 *
 * // 同額プラン間の変更（通常はビジネスロジックで禁止されるべき）
 * determineChangeTypeByPrice(1000, 1000); // 'upgrade'
 */
export function determineChangeType(
  currentPriceAmount: number,
  newPriceAmount: number
): PlanChangeType {
  return newPriceAmount >= currentPriceAmount ? 'upgrade' : 'downgrade';
}
