import React, { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import queryString from 'query-string';
import { WriterPageQueryParams } from '@/@types/navigate';
import { useTranslation } from 'react-i18next';
import PageContainer from '@/components/layout/PageContainer';

const TailwindAdvancedEditor = lazy(
  () => import('../components/Writer/AdvancedEditor')
);

const WriterPage: React.FC = () => {
  const { search } = useLocation();
  const { t } = useTranslation();

  // Get initial value from URL parameters
  const initialSentence = React.useMemo(() => {
    if (search === '') return '';
    const params = queryString.parse(search) as WriterPageQueryParams;
    return params.sentence ?? '';
  }, [search]);

  return (
    <PageContainer title={t('writer.title')}>
      <div className="m-auto max-w-full p-2">
        <Suspense fallback={<div>{t('common.loading')}</div>}>
          <TailwindAdvancedEditor initialSentence={initialSentence} />
        </Suspense>
      </div>
    </PageContainer>
  );
};

export default WriterPage;
