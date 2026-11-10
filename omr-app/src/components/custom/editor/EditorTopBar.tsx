import { AlertTriangle, ArrowLeft, CheckCircle2, Save, ShieldCheck } from 'lucide-react';
import Button from '../../ui/Button';

interface Props {
  title: string;
  statusLabel: string;
  statusDetail: string;
  pendingVersion?: boolean;
  version: number;
  saving: boolean;
  dirty: boolean;
  onClose: () => void;
  onSave: () => void;
  onValidate: () => void;
  onActivate: () => void;
}

/** Barra superior do editor do Gabarito Personalizado. */
export default function EditorTopBar({
  title, statusLabel, statusDetail, pendingVersion, version,
  saving, dirty, onClose, onSave, onValidate, onActivate,
}: Props) {
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line pb-2 dark:border-gray-800">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold tracking-tight text-[#172B4D] dark:text-white">
            {title}
          </h1>
          <p className="truncate text-[11px] text-[#71809A] dark:text-gray-400">
            {statusLabel} · {statusDetail}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} icon={<ArrowLeft size={15} aria-hidden />}>
            Modelos
          </Button>
          <Button variant="secondary" size="sm" onClick={onSave} loading={saving} disabled={!dirty} icon={<Save size={15} aria-hidden />}>
            Salvar
          </Button>
          <Button variant="secondary" size="sm" onClick={onValidate} icon={<CheckCircle2 size={15} aria-hidden />}>
            Validar
          </Button>
          <Button variant="success" size="sm" onClick={onActivate} icon={<ShieldCheck size={15} aria-hidden />}>
            {statusLabel === 'Ativo' ? 'Ativar nova versão' : 'Ativar modelo'}
          </Button>
        </div>
      </div>

      {pendingVersion && (
        <div className="callout-warning flex items-start gap-2 text-xs">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            Há alterações no editor que ainda não foram ativadas. A leitura e a
            impressão oficiais usam a versão <strong>{version}</strong>.
            Clique em <strong>Ativar nova versão</strong> antes de gerar cartões
            com o layout atual.
          </p>
        </div>
      )}
    </>
  );
}
