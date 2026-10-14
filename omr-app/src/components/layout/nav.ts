import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, GraduationCap, Users, ClipboardList, KeyRound, Printer,
  ScanLine, History, ClipboardCheck, BarChart3, FileText, FlaskConical,
  Settings, LifeBuoy, ShieldCheck, UserRound, ListChecks,
} from 'lucide-react';
import type { AppView } from '../../types';

export interface NavItem {
  view: AppView;
  label: string;
  icon: LucideIcon;
  /** Página ainda não construída — leva ao placeholder "Em breve". */
  soon?: boolean;
  adminOnly?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** Fonte única da navegação (sidebar + breadcrumbs + títulos). */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'gerenciamento',
    label: 'Gerenciamento',
    items: [
      { view: 'home', label: 'Painel inicial', icon: LayoutDashboard },
      { view: 'turmas', label: 'Turmas', icon: GraduationCap },
      { view: 'alunos', label: 'Alunos', icon: Users },
    ],
  },
  {
    id: 'avaliacoes',
    label: 'Avaliações',
    items: [
      { view: 'new-exam', label: 'Provas e avaliações', icon: ClipboardList },
      { view: 'register-key', label: 'Gabaritos', icon: KeyRound },
      { view: 'generate-card', label: 'Gerar cartões-resposta', icon: Printer },
      { view: 'manage-exam', label: 'Gerenciar avaliação', icon: ListChecks },
    ],
  },
  {
    id: 'correcao',
    label: 'Correção OMR',
    items: [
      { view: 'correct-card', label: 'Nova leitura', icon: ScanLine },
      { view: 'results', label: 'Histórico de correções', icon: History },
      { view: 'pending', label: 'Revisões pendentes', icon: ClipboardCheck },
    ],
  },
  {
    id: 'analises',
    label: 'Análises',
    items: [
      { view: 'dashboard', label: 'Resultados', icon: BarChart3 },
      { view: 'reports', label: 'Relatórios', icon: FileText },
      { view: 'lab', label: 'Banco de testes OMR', icon: FlaskConical },
    ],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    items: [
      { view: 'settings', label: 'Configurações', icon: Settings },
      { view: 'help', label: 'Ajuda e suporte', icon: LifeBuoy },
      { view: 'profile', label: 'Perfil do usuário', icon: UserRound },
      { view: 'admin-users', label: 'Usuários', icon: ShieldCheck, adminOnly: true },
    ],
  },
];

/** Atalhos da barra de navegação inferior (mobile). "Mais" abre o drawer. */
export interface BottomNavItem {
  view: AppView;
  label: string;
  icon: LucideIcon;
}

export const BOTTOM_NAV: BottomNavItem[] = [
  { view: 'home', label: 'Início', icon: LayoutDashboard },
  { view: 'correct-card', label: 'Nova leitura', icon: ScanLine },
  { view: 'dashboard', label: 'Resultados', icon: BarChart3 },
  { view: 'turmas', label: 'Turmas', icon: GraduationCap },
];

/** Título + grupo para TODAS as views (inclusive as fora da sidebar). */
export const VIEW_META: Record<AppView, { title: string; group: string }> = {
  home: { title: 'Painel inicial', group: 'Gerenciamento' },
  'new-exam': { title: 'Provas e avaliações', group: 'Avaliações' },
  turmas: { title: 'Turmas', group: 'Gerenciamento' },
  alunos: { title: 'Alunos', group: 'Gerenciamento' },
  'generate-card': { title: 'Gerar cartões-resposta', group: 'Avaliações' },
  'import-students': { title: 'Cartões por lista da prova', group: 'Avaliações' },
  'manage-exam': { title: 'Gerenciar avaliação', group: 'Avaliações' },
  'register-key': { title: 'Gabaritos', group: 'Avaliações' },
  'correct-card': { title: 'Nova leitura', group: 'Correção OMR' },
  results: { title: 'Histórico de correções', group: 'Correção OMR' },
  pending: { title: 'Revisões pendentes', group: 'Correção OMR' },
  dashboard: { title: 'Resultados', group: 'Análises' },
  reports: { title: 'Relatórios', group: 'Análises' },
  export: { title: 'Exportar', group: 'Análises' },
  lab: { title: 'Banco de testes OMR', group: 'Análises' },
  'view-result': { title: 'Detalhe da correção', group: 'Correção OMR' },
  settings: { title: 'Configurações', group: 'Sistema' },
  help: { title: 'Ajuda e suporte', group: 'Sistema' },
  profile: { title: 'Perfil do usuário', group: 'Sistema' },
  'admin-users': { title: 'Usuários', group: 'Sistema' },
};

/** Páginas de trabalho intensivo usam a largura total do monitor. */
export const WIDE_VIEWS: AppView[] = [
  'correct-card', 'manage-exam', 'results', 'dashboard', 'lab', 'view-result',
];

export function viewMeta(view: AppView): { title: string; group: string } {
  return VIEW_META[view];
}
