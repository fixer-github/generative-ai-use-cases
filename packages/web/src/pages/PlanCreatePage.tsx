import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PiArrowLeft, PiPlus, PiTrash } from 'react-icons/pi';
import Button from '../components/Button';
import Alert from '../components/Alert';
import LoadingOverlay from '../components/LoadingOverlay';
import usePlanApi, { CreatePlanRequest } from '../hooks/usePlanApi';

type InputMode = 'form' | 'json';

interface LimitConfig {
  model: string;
  type: 'unlimited' | 'daily' | 'monthly' | 'billing_period';
  count?: number;
}

const PlanCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { createPlan, checkPlanName } = usePlanApi();

  // Form states
  const [internalName, setInternalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [platformType, setPlatformType] = useState<'stripe' | 'apple' | 'google' | 'internal'>('stripe');
  const [platformProductId, setPlatformProductId] = useState('');

  // Permissions states
  const [inputMode, setInputMode] = useState<InputMode>('form');
  const [features, setFeatures] = useState<string[]>([]);
  const [newFeature, setNewFeature] = useState('');
  const [limits, setLimits] = useState<LimitConfig[]>([]);
  const [jsonInput, setJsonInput] = useState('');

  // UI states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameCheckStatus, setNameCheckStatus] = useState<'idle' | 'checking' | 'available' | 'unavailable'>('idle');
  const [showPreview, setShowPreview] = useState(false);

  const handleNameCheck = async () => {
    if (!internalName) return;

    try {
      setNameCheckStatus('checking');
      const result = await checkPlanName(internalName);

      if (result.available) {
        setNameCheckStatus('available');
      } else {
        setNameCheckStatus('unavailable');
        setError(`この内部名称は既に使われています (${result.conflicting_plan?.display_name})`);
      }
    } catch (err) {
      console.error('Failed to check plan name:', err);
      setError('内部名称の確認に失敗しました');
    }
  };

  const handleAddFeature = () => {
    if (newFeature && !features.includes(newFeature)) {
      setFeatures([...features, newFeature]);
      setNewFeature('');
    }
  };

  const handleRemoveFeature = (feature: string) => {
    setFeatures(features.filter((f) => f !== feature));
  };

  const handleAddLimit = () => {
    setLimits([...limits, { model: '', type: 'unlimited' }]);
  };

  const handleUpdateLimit = (index: number, field: keyof LimitConfig, value: any) => {
    const newLimits = [...limits];
    newLimits[index] = { ...newLimits[index], [field]: value };
    setLimits(newLimits);
  };

  const handleRemoveLimit = (index: number) => {
    setLimits(limits.filter((_, i) => i !== index));
  };

  const getPermissionsFromForm = () => {
    const limitsObj: any = {};
    limits.forEach((limit) => {
      if (limit.model) {
        limitsObj[limit.model] = {
          type: limit.type,
          ...(limit.type !== 'unlimited' && { count: limit.count || 0 }),
        };
      }
    });

    return {
      features,
      limits: limitsObj,
    };
  };

  const getPermissionsFromJSON = () => {
    try {
      return JSON.parse(jsonInput);
    } catch (err) {
      throw new Error('JSON形式が正しくありません');
    }
  };

  const validateForm = (): string | null => {
    if (!internalName) return '内部名称は必須です';
    if (!displayName) return '表示名は必須です';
    if (platformType !== 'internal' && !platformProductId) {
      return 'プラットフォーム商品IDは必須です';
    }

    // Validate permissions
    try {
      const permissions = inputMode === 'form' ? getPermissionsFromForm() : getPermissionsFromJSON();

      if (!permissions.features || !Array.isArray(permissions.features)) {
        return '権限設定のfeaturesフィールドが必須です';
      }
      if (!permissions.limits || typeof permissions.limits !== 'object') {
        return '権限設定のlimitsフィールドが必須です';
      }

      // Validate limits structure
      for (const [model, limit] of Object.entries(permissions.limits) as [string, any][]) {
        if (!limit.type || !['unlimited', 'daily', 'monthly', 'billing_period'].includes(limit.type)) {
          return `${model}の制限タイプが不正です`;
        }
        if (limit.type !== 'unlimited' && (!limit.count || limit.count <= 0)) {
          return `${model}の制限回数が不正です`;
        }
      }
    } catch (err: any) {
      return err.message || '権限設定が不正です';
    }

    return null;
  };

  const handleSubmit = async () => {
    setError(null);

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (nameCheckStatus !== 'available') {
      setError('内部名称の重複チェックを実行してください');
      return;
    }

    try {
      setLoading(true);

      const permissions = inputMode === 'form' ? getPermissionsFromForm() : getPermissionsFromJSON();

      const planData: CreatePlanRequest = {
        internal_name: internalName,
        display_name: displayName,
        platform_type: platformType,
        permissions,
      };

      if (description) planData.description = description;
      if (platformType !== 'internal' && platformProductId) {
        planData.platform_product_id = platformProductId;
      }

      const createdPlan = await createPlan(planData);
      navigate(`/admin/billing/plans/${createdPlan.plan_id}`);
    } catch (err: any) {
      console.error('Failed to create plan:', err);

      if (err?.response?.data?.error?.code === 'DUPLICATE_INTERNAL_NAME') {
        setError('この内部名称は既に使われています');
        setNameCheckStatus('unavailable');
      } else if (err?.response?.data?.error?.message) {
        setError(err.response.data.error.message);
      } else {
        setError('プランの作成に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  const getPreviewJSON = () => {
    try {
      const permissions = inputMode === 'form' ? getPermissionsFromForm() : getPermissionsFromJSON();
      return JSON.stringify(permissions, null, 2);
    } catch (err) {
      return 'エラー: JSON形式が不正です';
    }
  };

  if (loading) {
    return <LoadingOverlay>プランを作成中...</LoadingOverlay>;
  }

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 xl:px-12 2xl:px-32">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-8">
          <Button
            outlined
            onClick={() => navigate('/admin/billing/plans')}
            className="mb-4">
            <PiArrowLeft className="mr-2" />
            一覧に戻る
          </Button>

          <h1 className="text-2xl font-bold text-gray-900">新しいプランを作成</h1>
          <p className="mt-1 text-sm text-gray-600">
            プランの基本情報と権限設定を入力してください
          </p>
        </div>

        {error && (
          <div className="mb-6">
            <Alert severity="error" className="w-full">
              {error}
            </Alert>
          </div>
        )}

        <div className="space-y-6">
          {/* Basic Information Section */}
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">基本情報</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  内部名称 <span className="text-red-600">*</span>
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={internalName}
                    onChange={(e) => {
                      setInternalName(e.target.value);
                      setNameCheckStatus('idle');
                    }}
                    placeholder="例: standard_2025_jan_stripe"
                    className="flex-1 rounded border border-gray-300 px-3 py-2"
                  />
                  <Button outlined onClick={handleNameCheck} disabled={!internalName}>
                    {nameCheckStatus === 'checking' ? '確認中...' : '重複チェック'}
                  </Button>
                </div>
                {nameCheckStatus === 'available' && (
                  <p className="mt-1 text-sm text-green-600">この名称は使用可能です</p>
                )}
                {nameCheckStatus === 'unavailable' && (
                  <p className="mt-1 text-sm text-red-600">この名称は既に使われています</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  推奨形式: プラン種別_作成年月_プラットフォーム
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  表示名 <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="例: Standardプラン"
                  className="w-full rounded border border-gray-300 px-3 py-2"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">説明</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="プランの詳しい説明を記入します"
                  rows={3}
                  className="w-full rounded border border-gray-300 px-3 py-2"
                />
              </div>
            </div>
          </div>

          {/* Platform Settings Section */}
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">プラットフォーム設定</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  プラットフォーム種別 <span className="text-red-600">*</span>
                </label>
                <select
                  value={platformType}
                  onChange={(e) => setPlatformType(e.target.value as any)}
                  className="w-full rounded border border-gray-300 px-3 py-2">
                  <option value="stripe">Stripe</option>
                  <option value="apple">Apple</option>
                  <option value="google">Google</option>
                  <option value="internal">Internal</option>
                </select>
              </div>

              {platformType !== 'internal' && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    プラットフォーム商品ID <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={platformProductId}
                    onChange={(e) => setPlatformProductId(e.target.value)}
                    placeholder={
                      platformType === 'stripe'
                        ? '例: price_1234567890'
                        : platformType === 'apple'
                          ? '例: com.example.standard_monthly'
                          : '例: standard_monthly'
                    }
                    className="w-full rounded border border-gray-300 px-3 py-2"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Permissions Section */}
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">権限・制限定義</h2>

            {/* Input Mode Toggle */}
            <div className="mb-4 flex space-x-4">
              <button
                onClick={() => setInputMode('form')}
                className={`rounded px-4 py-2 ${
                  inputMode === 'form'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}>
                フォームで入力
              </button>
              <button
                onClick={() => setInputMode('json')}
                className={`rounded px-4 py-2 ${
                  inputMode === 'json'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}>
                JSONを直接入力
              </button>
            </div>

            {inputMode === 'form' ? (
              <div className="space-y-6">
                {/* Features */}
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    利用可能な機能
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={newFeature}
                      onChange={(e) => setNewFeature(e.target.value)}
                      placeholder="例: feature_a"
                      className="flex-1 rounded border border-gray-300 px-3 py-2"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddFeature();
                        }
                      }}
                    />
                    <Button onClick={handleAddFeature}>
                      <PiPlus className="mr-2" />
                      追加
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {features.map((feature) => (
                      <span
                        key={feature}
                        className="inline-flex items-center rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">
                        {feature}
                        <button
                          onClick={() => handleRemoveFeature(feature)}
                          className="ml-2 text-green-600 hover:text-green-800">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>

                {/* Limits */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-medium text-gray-700">利用回数の制限</label>
                    <Button outlined onClick={handleAddLimit}>
                      <PiPlus className="mr-2" />
                      モデルを追加
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {limits.map((limit, index) => (
                      <div key={index} className="flex items-end space-x-2">
                        <div className="flex-1">
                          <label className="mb-1 block text-xs text-gray-600">モデル名</label>
                          <input
                            type="text"
                            value={limit.model}
                            onChange={(e) => handleUpdateLimit(index, 'model', e.target.value)}
                            placeholder="例: model_a"
                            className="w-full rounded border border-gray-300 px-3 py-2"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="mb-1 block text-xs text-gray-600">制限タイプ</label>
                          <select
                            value={limit.type}
                            onChange={(e) => handleUpdateLimit(index, 'type', e.target.value)}
                            className="w-full rounded border border-gray-300 px-3 py-2">
                            <option value="unlimited">無制限</option>
                            <option value="daily">日次制限</option>
                            <option value="monthly">月次制限（暦月）</option>
                            <option value="billing_period">請求期間制限</option>
                          </select>
                        </div>
                        {limit.type !== 'unlimited' && (
                          <div className="flex-1">
                            <label className="mb-1 block text-xs text-gray-600">回数</label>
                            <input
                              type="number"
                              value={limit.count || ''}
                              onChange={(e) =>
                                handleUpdateLimit(index, 'count', parseInt(e.target.value) || 0)
                              }
                              placeholder="100"
                              className="w-full rounded border border-gray-300 px-3 py-2"
                            />
                          </div>
                        )}
                        <Button outlined onClick={() => handleRemoveLimit(index)}>
                          <PiTrash />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  JSON形式で入力
                </label>
                <textarea
                  value={jsonInput}
                  onChange={(e) => setJsonInput(e.target.value)}
                  placeholder={`{\n  "features": ["feature_a", "feature_b"],\n  "limits": {\n    "model_a": {\n      "type": "unlimited"\n    },\n    "model_b": {\n      "type": "monthly",\n      "count": 400\n    }\n  }\n}`}
                  rows={15}
                  className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
                />
              </div>
            )}

            {/* Preview */}
            <div className="mt-6">
              <button
                onClick={() => setShowPreview(!showPreview)}
                className="text-sm text-blue-600 hover:text-blue-800">
                {showPreview ? 'プレビューを閉じる' : 'プレビューを表示'}
              </button>
              {showPreview && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-gray-100 p-4 text-xs">
                  {getPreviewJSON()}
                </pre>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end space-x-3">
            <Button outlined onClick={() => navigate('/admin/billing/plans')}>
              キャンセル
            </Button>
            <Button className="bg-green-600 hover:bg-green-700" onClick={handleSubmit}>
              作成
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanCreatePage;
