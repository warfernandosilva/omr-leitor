import { useEffect, useMemo, useState } from 'react';
import Badge from '../ui/Badge';
import { LabImage, LabQuestionView, labFetchRectified, labStatusTone } from '../../utils/lab-api';

interface Props {
  images: LabImage[];
}

function statusBadge(q: LabQuestionView) {
  return <Badge tone={labStatusTone(q.status)}>{q.label}</Badge>;
}

export default function ReviewPanel({ images }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(images[0]?.id ?? null);
  const [question, setQuestion] = useState<number | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);

  useEffect(() => {
    if (images.length > 0 && !images.some(i => i.id === selectedId)) {
      setSelectedId(images[0].id);
      setQuestion(null);
    }
  }, [images, selectedId]);

  const image = useMemo(() => images.find(i => i.id === selectedId) ?? null, [images, selectedId]);

  useEffect(() => {
    let revoke: string | null = null;
    let alive = true;
    setImgUrl(null);
    setImgError(null);
    if (image && image.status === 'processed' && image.rectified_url) {
      labFetchRectified(image.id)
        .then(blob => {
          if (!alive) return;
          revoke = URL.createObjectURL(blob);
          setImgUrl(revoke);
        })
        .catch(err => { if (alive) setImgError(err instanceof Error ? err.message : 'Falha ao carregar a imagem'); });
    }
    return () => {
      alive = false;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [image]);

  const questionDetail = image?.questions.find(q => q.question === question) ?? null;

  if (images.length === 0) {
    return (
      <div className="card text-center py-10 text-gray-500 dark:text-gray-400">
        Nenhuma foto nesta sessão. Vá para <strong>Coleta &amp; Gabarito</strong> e envie fotos.
      </div>
    );
  }

  const okCount = image?.questions.filter(q => q.status === 'ok').length ?? 0;
  const ambiguous = image?.questions.filter(q => q.status === 'low' || q.status === 'duplicate').length ?? 0;
  const blank = image?.questions.filter(q => q.status === 'blank').length ?? 0;

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-6">
      <div className="card p-0 overflow-hidden">
        <div className="p-3 border-b border-line dark:border-gray-800 text-sm font-semibold text-gray-600 dark:text-gray-200">
          Fotos ({images.length})
        </div>
        <ul className="max-h-[70vh] overflow-y-auto">
          {images.map(img => (
            <li key={img.id}>
              <button
                onClick={() => { setSelectedId(img.id); setQuestion(null); }}
                className={`w-full text-left px-3 py-2.5 text-sm border-b border-line/60 dark:border-gray-800/60 transition-colors min-h-[44px] ${
                  img.id === selectedId
                    ? 'bg-brand-50 dark:bg-brand-700/15 text-brand-800 dark:text-brand-200'
                    : 'hover:bg-surface dark:hover:bg-gray-800/50'
                }`}
              >
                <span className="block truncate font-medium">{img.filename}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {img.status === 'error' ? 'erro' : `${img.total_questions} questões`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-6 min-w-0">
        {!image && <div className="card text-gray-500 dark:text-gray-400">Selecione uma foto.</div>}

        {image?.status === 'error' && (
          <div className="callout-danger">
            <strong>Esta foto não foi lida.</strong>
            <p className="mt-1">{image.error || 'Motivo não informado.'}</p>
          </div>
        )}

        {image && image.status === 'processed' && (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <div className="card text-center py-3">
                <p className="text-xl font-bold text-success-600 dark:text-success-100 tabular-nums">{okCount}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">marcadas</p>
              </div>
              <div className="card text-center py-3">
                <p className="text-xl font-bold text-warning-600 dark:text-warning-100 tabular-nums">{ambiguous}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">ambíguas</p>
              </div>
              <div className="card text-center py-3">
                <p className="text-xl font-bold text-gray-500 dark:text-gray-400 tabular-nums">{blank}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">brancos</p>
              </div>
            </div>

            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100">Imagem retificada</h3>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  QR: {image.qr_id ?? '—'} · floor {image.floor_used?.toFixed(2) ?? '—'} ({image.floor_source ?? '—'})
                </span>
              </div>
              {imgError && <p className="text-sm text-danger-600 dark:text-danger-100">{imgError}</p>}
              {!imgError && !imgUrl && <div className="skeleton h-64 w-full" />}
              {imgUrl && (
                <img src={imgUrl} alt={`Retificada ${image.filename}`} className="max-h-[60vh] mx-auto rounded-lg border border-line dark:border-gray-800" />
              )}
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100 mb-3">
                Questões — clique para ver os scores das bolhas
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {image.questions.map(q => {
                  const tone = labStatusTone(q.status);
                  const base = tone === 'success'
                    ? 'bg-success-50 text-success-600 border-success-500/30 dark:bg-success-700/15 dark:text-success-100 dark:border-success-700'
                    : tone === 'info'
                      ? 'bg-surface text-gray-600 border-line dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                      : 'bg-warning-50 text-warning-600 border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-100 dark:border-warning-700';
                  const sel = q.question === question ? 'ring-2 ring-brand-500' : '';
                  return (
                    <button
                      key={q.question}
                      onClick={() => setQuestion(q.question)}
                      title={`Q${q.question}: ${q.label}${q.detected ? ` (${q.detected})` : ''}`}
                      aria-pressed={q.question === question}
                      className={`w-9 h-9 min-w-[44px] min-h-[44px] rounded-lg border text-xs font-semibold ${base} ${sel}`}
                    >
                      {q.question}
                    </button>
                  );
                })}
              </div>
            </div>

            {questionDetail && (
              <div className="card">
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-100">Questão {questionDetail.question}</h3>
                  {statusBadge(questionDetail)}
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    detectado: <strong>{questionDetail.detected ?? '—'}</strong> · gabarito: <strong>{questionDetail.truth ?? '—'}</strong>
                    {questionDetail.truth && questionDetail.status === 'ok' && (
                      questionDetail.detected === questionDetail.truth
                        ? <span className="text-success-600 dark:text-success-100"> · correta</span>
                        : <span className="text-danger-600 dark:text-danger-100"> · incorreta</span>
                    )}
                  </span>
                  {questionDetail.duplicate_marks && (
                    <span className="text-xs text-warning-600 dark:text-warning-100">marcas: {questionDetail.duplicate_marks.join(', ')}</span>
                  )}
                </div>
                <div className="space-y-2">
                  {(questionDetail.options ?? []).map(o => (
                    <div key={o.option} className="flex items-center gap-3">
                      <span className="w-5 text-sm font-bold text-gray-600 dark:text-gray-200">{o.option}</span>
                      <div className="flex-1 h-5 bg-surface dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-brand-500"
                          style={{ width: `${Math.max(0, Math.min(1, o.score)) * 100}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs text-gray-500 dark:text-gray-400 tabular-nums">{o.score.toFixed(3)}</span>
                    </div>
                  ))}
                  {(!questionDetail.options || questionDetail.options.length === 0) && (
                    <p className="text-xs text-gray-400 dark:text-gray-500">Sem componentes salvos para esta questão.</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}