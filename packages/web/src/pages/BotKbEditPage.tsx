import React, { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PiCaretLeft, PiPlus, PiTrash } from 'react-icons/pi';
import Button from '../components/Button';
import InputText from '../components/InputText';
import Textarea from '../components/Textarea';
import Select from '../components/Select';
import Alert from '../components/Alert';
import RangeSlider from '../components/RangeSlider';
import Switch from '../components/Switch';
import Card from '../components/Card';
import Help from '../components/Help';
import RowItem from '../components/RowItem';

interface BotFile {
  filename: string;
  status: 'UPLOADING' | 'UPLOADED' | 'ERROR';
  size?: number;
}

interface ChunkingParams {
  strategy: 'FIXED_SIZE' | 'HIERARCHICAL' | 'SEMANTIC' | 'NONE';
  maxTokens?: number;
  overlapTokens?: number;
  bufferSize?: number;
  breakpointPercentileThreshold?: number;
  numberOfInferenceSteps?: number;
  maxParentTokenSize?: number;
  maxChildTokenSize?: number;
}

interface SearchParams {
  maxResults: number;
  searchType: 'HYBRID' | 'SEMANTIC';
  hybridSearchAlpha?: number;
  filter?: {
    andAll?: Array<{
      equals?: { key: string; value: string };
      greaterThan?: { key: string; value: number };
      lessThan?: { key: string; value: number };
    }>;
  };
}

const BotKbEditPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { botId } = useParams();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Basic Information
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [instruction, setInstruction] = useState('');

  // Knowledge Base Sources
  const [urls, setUrls] = useState<string[]>(['']);
  const [s3Urls, setS3Urls] = useState<string[]>(['']);
  const [files, setFiles] = useState<BotFile[]>([]);

  // Model Settings
  const [embeddingModel, setEmbeddingModel] = useState('titan-embed-text-v2:0');
  const [parsingModel, setParsingModel] = useState(
    'anthropic.claude-3-haiku-20240307-v1:0'
  );

  // Generation Settings
  const [displayRetrievedChunks, setDisplayRetrievedChunks] = useState(true);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [topK, setTopK] = useState(250);
  const [stopSequences] = useState<string[]>([]);

  // Chunking Settings
  const [chunkingParams, setChunkingParams] = useState<ChunkingParams>({
    strategy: 'FIXED_SIZE',
    maxTokens: 512,
    overlapTokens: 20,
  });

  // Search Settings
  const [searchParams, setSearchParams] = useState<SearchParams>({
    maxResults: 10,
    searchType: 'HYBRID',
    hybridSearchAlpha: 0.5,
  });

  // Web Crawling Settings
  const [webCrawlingScope, setWebCrawlingScope] = useState<
    'DEFAULT' | 'HOST_ONLY' | 'SUBDOMAIN'
  >('DEFAULT');
  const [webCrawlingFilters, setWebCrawlingFilters] = useState({
    includePatterns: [''],
    excludePatterns: [''],
  });

  // Guardrails Settings
  const [useGuardrails, setUseGuardrails] = useState(false);
  const [guardrailsConfig, setGuardrailsConfig] = useState({
    hateThreshold: 0.5,
    insultsThreshold: 0.5,
    sexualThreshold: 0.5,
    violenceThreshold: 0.5,
    misconductThreshold: 0.5,
    groundingThreshold: 0.5,
    relevanceThreshold: 0.5,
  });

  const handleAddUrl = useCallback(() => {
    setUrls([...urls, '']);
  }, [urls]);

  const handleRemoveUrl = useCallback(
    (index: number) => {
      setUrls(urls.filter((_, i) => i !== index));
    },
    [urls]
  );

  const handleUpdateUrl = useCallback(
    (index: number, value: string) => {
      const newUrls = [...urls];
      newUrls[index] = value;
      setUrls(newUrls);
    },
    [urls]
  );

  const handleAddS3Url = useCallback(() => {
    setS3Urls([...s3Urls, '']);
  }, [s3Urls]);

  const handleRemoveS3Url = useCallback(
    (index: number) => {
      setS3Urls(s3Urls.filter((_, i) => i !== index));
    },
    [s3Urls]
  );

  const handleUpdateS3Url = useCallback(
    (index: number, value: string) => {
      const newS3Urls = [...s3Urls];
      newS3Urls[index] = value;
      setS3Urls(newS3Urls);
    },
    [s3Urls]
  );

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const uploadedFiles = event.target.files;
      if (!uploadedFiles) return;

      const newFiles: BotFile[] = Array.from(uploadedFiles).map((file) => ({
        filename: file.name,
        status: 'UPLOADING' as const,
        size: file.size,
      }));

      setFiles([...files, ...newFiles]);

      // Simulate file upload
      setTimeout(() => {
        setFiles((prevFiles) =>
          prevFiles.map((file) =>
            newFiles.find((nf) => nf.filename === file.filename)
              ? { ...file, status: 'UPLOADED' as const }
              : file
          )
        );
      }, 1000);
    },
    [files]
  );

  const handleRemoveFile = useCallback(
    (filename: string) => {
      setFiles(files.filter((f) => f.filename !== filename));
    },
    [files]
  );

  const handleSave = useCallback(async () => {
    if (!title) {
      setError(t('bot.titleRequired'));
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // TODO: Implement save logic
      console.log('Saving bot configuration...', {
        title,
        description,
        instruction,
        urls: urls.filter((url) => url),
        s3Urls: s3Urls.filter((url) => url),
        files,
        embeddingModel,
        parsingModel,
        chunkingParams,
        searchParams,
        webCrawlingScope,
        webCrawlingFilters,
        guardrailsConfig: useGuardrails ? guardrailsConfig : null,
        generationConfig: {
          maxTokens,
          temperature,
          topP,
          topK,
          stopSequences,
        },
      });

      // Navigate back after successful save
      navigate(-1);
    } catch (err) {
      setError(t('bot.saveFailed'));
      console.error('Failed to save bot:', err);
    } finally {
      setIsLoading(false);
    }
  }, [
    title,
    description,
    instruction,
    urls,
    s3Urls,
    files,
    embeddingModel,
    parsingModel,
    chunkingParams,
    searchParams,
    webCrawlingScope,
    webCrawlingFilters,
    useGuardrails,
    guardrailsConfig,
    maxTokens,
    temperature,
    topP,
    topK,
    stopSequences,
    navigate,
    t,
  ]);

  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center border-b p-4">
        <button
          className="mr-4 flex items-center text-gray-600 hover:text-gray-900"
          onClick={() => navigate(-1)}>
          <PiCaretLeft className="mr-1" size={20} />
          {t('common.back')}
        </button>
        <h1 className="text-xl font-semibold">
          {botId ? t('bot.edit.pageTitle') : t('bot.create.pageTitle')}
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          {error && (
            <Alert severity="error" onDissmiss={() => setError('')}>
              {error}
            </Alert>
          )}

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.basicInfo')}
              </h2>
              <div className="space-y-4">
                <InputText
                  label={t('bot.title')}
                  value={title}
                  onChange={setTitle}
                  required
                  placeholder={t('bot.titlePlaceholder')}
                />
                <Textarea
                  label={t('bot.description')}
                  value={description}
                  onChange={setDescription}
                  placeholder={t('bot.descriptionPlaceholder')}
                  rows={3}
                />
                <Textarea
                  label={t('bot.instruction')}
                  value={instruction}
                  onChange={setInstruction}
                  placeholder={t('bot.instructionPlaceholder')}
                  help={t('bot.instructionHelp')}
                  rows={5}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.knowledgeBase')}
              </h2>

              <div className="space-y-6">
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-medium">
                      {t('bot.urls')}
                    </label>
                    <Button onClick={handleAddUrl} outlined>
                      <PiPlus className="mr-1" size={16} />
                      {t('common.add')}
                    </Button>
                  </div>
                  {urls.map((url, index) => (
                    <div key={index} className="mb-2 flex items-center gap-2">
                      <InputText
                        value={url}
                        onChange={(value) => handleUpdateUrl(index, value)}
                        placeholder="https://example.com"
                        className="flex-1"
                      />
                      {urls.length > 1 && (
                        <button
                          onClick={() => handleRemoveUrl(index)}
                          className="text-red-500 hover:text-red-700">
                          <PiTrash size={20} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-sm font-medium">
                      {t('bot.s3Urls')}
                    </label>
                    <Button onClick={handleAddS3Url} outlined>
                      <PiPlus className="mr-1" size={16} />
                      {t('common.add')}
                    </Button>
                  </div>
                  {s3Urls.map((url, index) => (
                    <div key={index} className="mb-2 flex items-center gap-2">
                      <InputText
                        value={url}
                        onChange={(value) => handleUpdateS3Url(index, value)}
                        placeholder="s3://bucket/path/"
                        className="flex-1"
                      />
                      {s3Urls.length > 1 && (
                        <button
                          onClick={() => handleRemoveS3Url(index)}
                          className="text-red-500 hover:text-red-700">
                          <PiTrash size={20} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">
                    {t('bot.files')}
                  </label>
                  <input
                    type="file"
                    multiple
                    onChange={handleFileUpload}
                    className="mb-2 block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100"
                  />
                  {files.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {files.map((file) => (
                        <div
                          key={file.filename}
                          className="flex items-center justify-between rounded bg-gray-50 p-2">
                          <span className="text-sm">{file.filename}</span>
                          <div className="flex items-center gap-2">
                            {file.status === 'UPLOADING' && (
                              <span className="text-xs text-gray-500">
                                {t('common.uploading')}
                              </span>
                            )}
                            {file.status === 'UPLOADED' && (
                              <span className="text-xs text-green-600">
                                {t('common.uploaded')}
                              </span>
                            )}
                            {file.status === 'ERROR' && (
                              <span className="text-xs text-red-600">
                                {t('common.error')}
                              </span>
                            )}
                            <button
                              onClick={() => handleRemoveFile(file.filename)}
                              className="text-red-500 hover:text-red-700">
                              <PiTrash size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.modelSettings')}
              </h2>
              <div className="space-y-4">
                <Select
                  label={t('bot.embeddingModel')}
                  value={embeddingModel}
                  onChange={setEmbeddingModel}
                  options={[
                    {
                      value: 'titan-embed-text-v2:0',
                      label: 'Titan Embed Text v2',
                    },
                    {
                      value: 'titan-embed-text-v1',
                      label: 'Titan Embed Text v1',
                    },
                    {
                      value: 'cohere.embed-english-v3',
                      label: 'Cohere Embed English v3',
                    },
                    {
                      value: 'cohere.embed-multilingual-v3',
                      label: 'Cohere Embed Multilingual v3',
                    },
                  ]}
                />
                <Select
                  label={t('bot.parsingModel')}
                  value={parsingModel}
                  onChange={setParsingModel}
                  options={[
                    {
                      value: 'anthropic.claude-3-haiku-20240307-v1:0',
                      label: 'Claude 3 Haiku',
                    },
                    {
                      value: 'anthropic.claude-3-sonnet-20240229-v1:0',
                      label: 'Claude 3 Sonnet',
                    },
                    {
                      value: 'anthropic.claude-3-opus-20240229-v1:0',
                      label: 'Claude 3 Opus',
                    },
                  ]}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.generationSettings')}
              </h2>
              <div className="space-y-4">
                <RowItem>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <span className="text-sm">
                        {t('bot.displayRetrievedChunks')}
                      </span>
                      <Help
                        className="ml-2"
                        message={t('bot.displayRetrievedChunksHelp')}
                      />
                    </div>
                    <Switch
                      checked={displayRetrievedChunks}
                      onSwitch={setDisplayRetrievedChunks}
                      label=""
                    />
                  </div>
                </RowItem>

                <RangeSlider
                  label={t('bot.maxTokens')}
                  value={maxTokens}
                  onChange={setMaxTokens}
                  min={1}
                  max={4096}
                  step={1}
                  help={t('bot.maxTokensHelp')}
                />

                <RangeSlider
                  label={t('bot.temperature')}
                  value={temperature}
                  onChange={setTemperature}
                  min={0}
                  max={1}
                  step={0.01}
                  help={t('bot.temperatureHelp')}
                />

                <RangeSlider
                  label="Top P"
                  value={topP}
                  onChange={setTopP}
                  min={0}
                  max={1}
                  step={0.01}
                  help={t('bot.topPHelp')}
                />

                <RangeSlider
                  label="Top K"
                  value={topK}
                  onChange={setTopK}
                  min={0}
                  max={500}
                  step={1}
                  help={t('bot.topKHelp')}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.chunkingSettings')}
              </h2>
              <div className="space-y-4">
                <Select
                  label={t('bot.chunkingStrategy')}
                  value={chunkingParams.strategy}
                  onChange={(value) =>
                    setChunkingParams({
                      ...chunkingParams,
                      strategy: value as ChunkingParams['strategy'],
                    })
                  }
                  options={[
                    { value: 'FIXED_SIZE', label: t('bot.fixedSize') },
                    { value: 'HIERARCHICAL', label: t('bot.hierarchical') },
                    { value: 'SEMANTIC', label: t('bot.semantic') },
                    { value: 'NONE', label: t('bot.none') },
                  ]}
                />

                {chunkingParams.strategy === 'FIXED_SIZE' && (
                  <>
                    <RangeSlider
                      label={t('bot.maxTokensPerChunk')}
                      value={chunkingParams.maxTokens || 512}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          maxTokens: value,
                        })
                      }
                      min={20}
                      max={8192}
                      step={1}
                    />
                    <RangeSlider
                      label={t('bot.overlapTokens')}
                      value={chunkingParams.overlapTokens || 20}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          overlapTokens: value,
                        })
                      }
                      min={0}
                      max={100}
                      step={1}
                    />
                  </>
                )}

                {chunkingParams.strategy === 'SEMANTIC' && (
                  <>
                    <RangeSlider
                      label={t('bot.bufferSize')}
                      value={chunkingParams.bufferSize || 0}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          bufferSize: value,
                        })
                      }
                      min={0}
                      max={10}
                      step={1}
                    />
                    <RangeSlider
                      label={t('bot.breakpointThreshold')}
                      value={chunkingParams.breakpointPercentileThreshold || 95}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          breakpointPercentileThreshold: value,
                        })
                      }
                      min={50}
                      max={100}
                      step={1}
                    />
                    <RangeSlider
                      label={t('bot.maxTokensPerChunk')}
                      value={chunkingParams.maxTokens || 512}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          maxTokens: value,
                        })
                      }
                      min={20}
                      max={8192}
                      step={1}
                    />
                  </>
                )}

                {chunkingParams.strategy === 'HIERARCHICAL' && (
                  <>
                    <RangeSlider
                      label={t('bot.maxParentTokenSize')}
                      value={chunkingParams.maxParentTokenSize || 1536}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          maxParentTokenSize: value,
                        })
                      }
                      min={20}
                      max={8192}
                      step={1}
                    />
                    <RangeSlider
                      label={t('bot.maxChildTokenSize')}
                      value={chunkingParams.maxChildTokenSize || 512}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          maxChildTokenSize: value,
                        })
                      }
                      min={20}
                      max={8192}
                      step={1}
                    />
                    <RangeSlider
                      label={t('bot.overlapTokens')}
                      value={chunkingParams.overlapTokens || 20}
                      onChange={(value) =>
                        setChunkingParams({
                          ...chunkingParams,
                          overlapTokens: value,
                        })
                      }
                      min={0}
                      max={100}
                      step={1}
                    />
                  </>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.searchSettings')}
              </h2>
              <div className="space-y-4">
                <RangeSlider
                  label={t('bot.maxSearchResults')}
                  value={searchParams.maxResults}
                  onChange={(value) =>
                    setSearchParams({ ...searchParams, maxResults: value })
                  }
                  min={1}
                  max={100}
                  step={1}
                  help={t('bot.maxSearchResultsHelp')}
                />

                <Select
                  label={t('bot.searchType')}
                  value={searchParams.searchType}
                  onChange={(value) =>
                    setSearchParams({
                      ...searchParams,
                      searchType: value as SearchParams['searchType'],
                    })
                  }
                  options={[
                    { value: 'HYBRID', label: t('bot.hybrid') },
                    { value: 'SEMANTIC', label: t('bot.semantic') },
                  ]}
                />

                {searchParams.searchType === 'HYBRID' && (
                  <RangeSlider
                    label={t('bot.hybridSearchAlpha')}
                    value={searchParams.hybridSearchAlpha || 0.5}
                    onChange={(value) =>
                      setSearchParams({
                        ...searchParams,
                        hybridSearchAlpha: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                    help={t('bot.hybridSearchAlphaHelp')}
                  />
                )}
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.webCrawlingSettings')}
              </h2>
              <div className="space-y-4">
                <Select
                  label={t('bot.crawlingScope')}
                  value={webCrawlingScope}
                  onChange={(value) =>
                    setWebCrawlingScope(
                      value as 'DEFAULT' | 'HOST_ONLY' | 'SUBDOMAIN'
                    )
                  }
                  options={[
                    { value: 'DEFAULT', label: t('bot.crawlDefault') },
                    { value: 'HOST_ONLY', label: t('bot.crawlHostOnly') },
                    { value: 'SUBDOMAIN', label: t('bot.crawlSubdomain') },
                  ]}
                />

                <div>
                  <label className="mb-2 block text-sm font-medium">
                    {t('bot.includePatterns')}
                  </label>
                  {webCrawlingFilters.includePatterns.map((pattern, index) => (
                    <div key={index} className="mb-2 flex items-center gap-2">
                      <InputText
                        value={pattern}
                        onChange={(value) => {
                          const newPatterns = [
                            ...webCrawlingFilters.includePatterns,
                          ];
                          newPatterns[index] = value;
                          setWebCrawlingFilters({
                            ...webCrawlingFilters,
                            includePatterns: newPatterns,
                          });
                        }}
                        placeholder="*/blog/*"
                        className="flex-1"
                      />
                      {index ===
                        webCrawlingFilters.includePatterns.length - 1 && (
                        <Button
                          onClick={() =>
                            setWebCrawlingFilters({
                              ...webCrawlingFilters,
                              includePatterns: [
                                ...webCrawlingFilters.includePatterns,
                                '',
                              ],
                            })
                          }
                          outlined>
                          <PiPlus size={16} />
                        </Button>
                      )}
                      {webCrawlingFilters.includePatterns.length > 1 && (
                        <button
                          onClick={() =>
                            setWebCrawlingFilters({
                              ...webCrawlingFilters,
                              includePatterns:
                                webCrawlingFilters.includePatterns.filter(
                                  (_, i) => i !== index
                                ),
                            })
                          }
                          className="text-red-500 hover:text-red-700">
                          <PiTrash size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">
                    {t('bot.excludePatterns')}
                  </label>
                  {webCrawlingFilters.excludePatterns.map((pattern, index) => (
                    <div key={index} className="mb-2 flex items-center gap-2">
                      <InputText
                        value={pattern}
                        onChange={(value) => {
                          const newPatterns = [
                            ...webCrawlingFilters.excludePatterns,
                          ];
                          newPatterns[index] = value;
                          setWebCrawlingFilters({
                            ...webCrawlingFilters,
                            excludePatterns: newPatterns,
                          });
                        }}
                        placeholder="*/admin/*"
                        className="flex-1"
                      />
                      {index ===
                        webCrawlingFilters.excludePatterns.length - 1 && (
                        <Button
                          onClick={() =>
                            setWebCrawlingFilters({
                              ...webCrawlingFilters,
                              excludePatterns: [
                                ...webCrawlingFilters.excludePatterns,
                                '',
                              ],
                            })
                          }
                          outlined>
                          <PiPlus size={16} />
                        </Button>
                      )}
                      {webCrawlingFilters.excludePatterns.length > 1 && (
                        <button
                          onClick={() =>
                            setWebCrawlingFilters({
                              ...webCrawlingFilters,
                              excludePatterns:
                                webCrawlingFilters.excludePatterns.filter(
                                  (_, i) => i !== index
                                ),
                            })
                          }
                          className="text-red-500 hover:text-red-700">
                          <PiTrash size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="p-4">
              <h2 className="mb-4 text-lg font-semibold">
                {t('bot.guardrails')}
              </h2>
              <RowItem>
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="text-sm">{t('bot.enableGuardrails')}</span>
                    <Help className="ml-2" message={t('bot.guardrailsHelp')} />
                  </div>
                  <Switch
                    checked={useGuardrails}
                    onSwitch={setUseGuardrails}
                    label=""
                  />
                </div>
              </RowItem>

              {useGuardrails && (
                <div className="mt-4 space-y-4">
                  <RangeSlider
                    label={t('bot.hateThreshold')}
                    value={guardrailsConfig.hateThreshold}
                    onChange={(value) =>
                      setGuardrailsConfig({
                        ...guardrailsConfig,
                        hateThreshold: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <RangeSlider
                    label={t('bot.insultsThreshold')}
                    value={guardrailsConfig.insultsThreshold}
                    onChange={(value) =>
                      setGuardrailsConfig({
                        ...guardrailsConfig,
                        insultsThreshold: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <RangeSlider
                    label={t('bot.sexualThreshold')}
                    value={guardrailsConfig.sexualThreshold}
                    onChange={(value) =>
                      setGuardrailsConfig({
                        ...guardrailsConfig,
                        sexualThreshold: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <RangeSlider
                    label={t('bot.violenceThreshold')}
                    value={guardrailsConfig.violenceThreshold}
                    onChange={(value) =>
                      setGuardrailsConfig({
                        ...guardrailsConfig,
                        violenceThreshold: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <RangeSlider
                    label={t('bot.misconductThreshold')}
                    value={guardrailsConfig.misconductThreshold}
                    onChange={(value) =>
                      setGuardrailsConfig({
                        ...guardrailsConfig,
                        misconductThreshold: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <RangeSlider
                    label={t('bot.groundingThreshold')}
                    value={guardrailsConfig.groundingThreshold}
                    onChange={(value) =>
                      setGuardrailsConfig({
                        ...guardrailsConfig,
                        groundingThreshold: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <RangeSlider
                    label={t('bot.relevanceThreshold')}
                    value={guardrailsConfig.relevanceThreshold}
                    onChange={(value) =>
                      setGuardrailsConfig({
                        ...guardrailsConfig,
                        relevanceThreshold: value,
                      })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="border-t p-4">
        <div className="mx-auto flex max-w-4xl justify-end gap-2">
          <Button onClick={() => navigate(-1)} outlined disabled={isLoading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={isLoading}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BotKbEditPage;
