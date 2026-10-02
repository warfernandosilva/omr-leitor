import { useEffect, useMemo, useState } from 'react';
import { LabImage, LabQuestionView, labFetchRectified, labStatusTone } from '../../utils/lab-api';

interface Props {
  images: LabImage[];
}

function statusBadge(q: LabQuestionView) {
  const tone = labStatusTone(q.status);
  const cls = tone === 'success' ? 'badge-success' : tone === 'info' ? 'badge-info' : 'badge-warning';
  return <span className={cls}>{q.label}</span>;
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
      <div className="card text-center py-10 text-gray-500">
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
        <div className="p-3 border-b border-gray-100 dark:border-gray-800 text-sm font-semibold text-gray-700 dark:text-gray-200">
          Fotos ({images.length})
        </div>
        <ul className="max-h-[70vh] overflow-y-auto">
          {images.map(img => (
            <li key={img.id}>
              <button
                onClick={() => { setSelectedId(img.id); setQuestion(null); }}
                className={`w-full text-left px-3 py-2.5 text-sm border-b border-gray-50 dark:border-gray-800/60 transition-colors ${
                  img.id === selectedId
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-200'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <span className="block truncate font-medium">{img.filename}</span>
                <span className="text-xs text-gray-400">
                  {img.status === 'error' ? 'erro' : `${img.total_questions} questões`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-6 min-w-0">
        {!image && <div className="card text-gray-500">Selecione uma foto.</div>}

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
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{okCount}</p>
                <p className="text-xs text-gray-500">marcadas</p>
              </div>
              <div className="card text-center py-3">
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{ambiguous}</p>
                <p className="text-xs text-gray-500">ambíguas</p>
              </div>
              <div className="card text-center py-3">
                <p className="text-xl font-bold text-gray-500">{blank}</p>
                <p className="text-xs text-gray-500">brancos</p>
              </div>
            </div>

            <div className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Imagem retificada</h3>
                <span className="text-xs text-gray-400">
                  QR: {image.qr_id ?? '—'} · floor {image.floor_used?.toFixed(2) ?? '—'} ({image.floor_source ?? '—'})
                </span>
              </div>
              {imgError && <p className="text-sm text-red-600">{imgError}</p>}
              {!imgError && !imgUrl && <div className="skeleton h-64 w-full" />}
              {imgUrl && (
                <img src={imgUrl} alt={`Retificada ${image.filename}`} className="max-h-[60vh] mx-auto rounded-lg border border-gray-200 dark:border-gray-800" />
              )}
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">
                Questões — clique para ver os scores das bolhas
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {image.questions.map(q => {
                  const tone = labStatusTone(q.status);
                  const base = tone === 'success'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-900'
                    : tone === 'info'
                      ? 'bg-gray-50 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700'
                      : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-900';
                  const sel = q.question === question ? 'ring-2 ring-blue-500' : '';
                  return (
                    <button
                      key={q.question}
                      onClick={() => setQuestion(q.question)}
                      title={`Q${q.question}: ${q.label}${q.detected ? ` (${q.detected})` : ''}`}
                      className={`w-9 h-9 rounded-lg border text-xs font-semibold ${base} ${sel}`}
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
                  <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Questão {questionDetail.question}</h3>
                  {statusBadge(questionDetail)}
                  <span className="text-xs text-gray-500">
                    detectado: <strong>{questionDetail.detected ?? '—'}</strong> · gabarito: <strong>{questionDetail.truth ?? '—'}</strong>
                    {questionDetail.truth && questionDetail.status === 'ok' && (
                      questionDetail.detected === questionDetail.truth
                        ? <span className="text-emerald-600 dark:text-emerald-400"> · correta</span>
                        : <span className="text-red-600 dark:text-red-400"> · incorreta</span>
                    )}
                  </span>
                  {questionDetail.duplicate_marks && (
                    <span className="text-xs text-amber-600">marcas: {questionDetail.duplicate_marks.join(', ')}</span>
                  )}
                </div>
                <div className="space-y-2">
                  {(questionDetail.options ?? []).map(o => (
                    <div key={o.option} className="flex items-center gap-3">
                      <span className="w-5 text-sm font-bold text-gray-700 dark:text-gray-200">{o.option}</span>
                      <div className="flex-1 h-5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500"
                          style={{ width: `${Math.max(0, Math.min(1, o.score)) * 100}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs text-gray-500">{o.score.toFixed(3)}</span>
                    </div>
                  ))}
                  {(!questionDetail.options || questionDetail.options.length === 0) && (
                    <p className="text-xs text-gray-400">Sem componentes salvos para esta questão.</p>
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