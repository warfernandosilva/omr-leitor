import { createPortal } from 'react-dom';
import Button from '../ui/Button';

export interface GlobalSettingField {
  key: string;
  label: string;
  step: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  values: Record<string, unknown>;
  onChange: (key: string, value: number | undefined) => void;
  onSave: () => void;
}

const GLOBAL_SETTING_FIELDS: GlobalSettingField[] = [
  { key: 'floor', label: 'Piso (floor)', step: 0.01 },
  { key: 'margin', label: 'Margem (margin)', step: 0.01 },
  { key: 'low_conf_threshold', label: 'Limiar baixa confiança', step: 0.01 },
  { key: 'clahe_clip', label: 'CLAHE clip', step: 0.1 },
];

/** Configurações globais de detecção do leitor OMR (valores vazios = padrão). */
export default function ReaderSettingsPanel({ open, onClose, values, onChange, onSave }: Props) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
      <div className="card w-full max-w-md space-y-4">
        <div>
          <h3 className="text-lg font-bold text-[#172B4D] dark:text-white">Configurações de detecção</h3>
          <p className="text-xs text-[#71809A] dark:text-gray-400">
            Valores vazios usam o padrão do modelo.
          </p>
        </div>

        <div className="space-y-3">
          {GLOBAL_SETTING_FIELDS.map(({ key, label, step }) => (
            <div key={key} className="flex items-center gap-3">
              <label className="flex-1 text-sm text-[#172B4D] dark:text-gray-200">{label}</label>
              <input
                type="number"
                step={step}
                aria-label={label}
                value={values[key] === undefined || values[key] === null ? '' : String(values[key])}
                onChange={(e) => onChange(key, e.target.value === '' ? undefined : Number(e.target.value))}
                className="input !w-28 !min-h-[40px]"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3 dark:border-gray-800">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={onSave}>
            Salvar
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
