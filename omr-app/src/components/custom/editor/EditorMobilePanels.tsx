import type { ReactNode } from 'react';
import { Wrench, SlidersHorizontal, Stethoscope, Zap } from 'lucide-react';
import Modal from '../../ui/Modal';
import Tabs from '../../ui/Tabs';

export type EditorMobileTab = 'ferramentas' | 'propriedades' | 'diagnostico' | 'acoes';

interface Props {
  open: boolean;
  onClose: () => void;
  tab: EditorMobileTab;
  onTab: (tab: EditorMobileTab) => void;
  issueCount?: number;
  tools: ReactNode;
  properties: ReactNode;
  diagnostics: ReactNode;
  actions: ReactNode;
}

/**
 * Painéis do editor em tela pequena: ferramentas/laterais viram abas dentro
 * de um bottom sheet, sem cobrir o canvas quando fechado.
 */
export default function EditorMobilePanels({
  open, onClose, tab, onTab, issueCount, tools, properties, diagnostics, actions,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title="Editor" wide>
      <Tabs
        ariaLabel="Painéis do editor"
        active={tab}
        onChange={(id) => onTab(id as EditorMobileTab)}
        tabs={[
          { id: 'ferramentas', label: 'Ferramentas', icon: <Wrench size={14} aria-hidden /> },
          { id: 'propriedades', label: 'Propriedades', icon: <SlidersHorizontal size={14} aria-hidden /> },
          { id: 'diagnostico', label: 'Diagnóstico', badge: issueCount || undefined, icon: <Stethoscope size={14} aria-hidden /> },
          { id: 'acoes', label: 'Ações', icon: <Zap size={14} aria-hidden /> },
        ]}
      />
      <div className="pt-4">
        {tab === 'ferramentas' && tools}
        {tab === 'propriedades' && properties}
        {tab === 'diagnostico' && diagnostics}
        {tab === 'acoes' && actions}
      </div>
    </Modal>
  );
}
