import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from './Button';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Diálogo modal acessível (Escape fecha, clique no fundo fecha, trava o scroll). */
export default function Modal({ open, onClose, title, children, footer, wide = false }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/50" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} bg-white dark:bg-gray-900 rounded-xl shadow-modal border border-line dark:border-gray-800 max-h-[90dvh] flex flex-col animate-fade-in`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-line dark:border-gray-800">
          <h2 className="text-lg font-semibold text-ink dark:text-white">{title}</h2>
          <button ref={closeRef} onClick={onClose} className="btn-icon" aria-label="Fechar">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer ? (
          <div className="px-5 py-4 border-t border-line dark:border-gray-800 flex flex-wrap justify-end gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  loading?: boolean;
}

/** Confirmação para ações destrutivas. */
export function ConfirmModal({
  open, onClose, onConfirm, title, message, confirmLabel = 'Confirmar', loading = false,
}: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{message}</p>
    </Modal>
  );
}
