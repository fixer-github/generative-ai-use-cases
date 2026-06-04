/**
 * 新UI（GaiXer 医療版）配下の ESLint オーバーライド。
 *
 * 決定 D3（判断メモ_Phase1着工ブロッカー.md）：
 *   新UIは日本語固定。文言は strings.ts に集約し JSX へ直書きしないため、
 *   i18n 由来の lint ルールは本ディレクトリ配下で無効化する。
 *   旧UI側の i18n 体制はそのまま残置（撤去工事はしない）。
 *
 * また、新UIはデザインバンドル由来の手書きCSSクラス（.sx* / .gx*）を用いるため、
 * tailwindcss/no-custom-classname も本ディレクトリでは無効化する。
 */
module.exports = {
  rules: {
    'i18nhelper/no-jp-string': 'off',
    'i18nhelper/no-jp-comment': 'off',
    '@shopify/jsx-no-hardcoded-content': 'off',
    'tailwindcss/no-custom-classname': 'off',
  },
};
