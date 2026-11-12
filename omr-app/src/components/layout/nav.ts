import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, GraduationCap, Users, ClipboardList, KeyRound, Printer,
  ScanLine, History, ClipboardCheck, BarChart3, FileText, FlaskConical,
  Settings, LifeBuoy, ShieldCheck, UserRound, ListChecks, PenSquare,
} from 'lucide-react';
import type { AppView } from '../../types';

export interface NavItem {
  view: AppView;
  label: string;
  icon: LucideIcon;
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
    id: 'painel',
    label: 'Painel',
    items: [
      { view: 'home', label: 'Painel inicial', icon: LayoutDashboard },
    ],
  },
  {
    id: 'gestao',
    label: 'Gestão escolar',
    items: [
      { view: 'turmas', label: 'Turmas', icon: GraduationCap },
      { view: 'alunos', label: 'Alunos', icon: Users },
    ],
  },
  {
    id: 'avaliacoes',
    label: 'Avaliações',
    items: [
      { view: 'avaliacoes', label: 'Gerenciar avaliações', icon: ListChecks },
      { view: 'new-exam', label: 'Provas e avaliações', icon: ClipboardList },
      { view: 'provas', label: 'Gabaritos', icon: KeyRound },
      { view: 'custom-template', label: 'Gabaritos personalizados', icon: PenSquare },
      { view: 'generate-card', label: 'Gerar cartões-resposta', icon: Printer },
    ],
  },
  {
    id: 'correcao',
    label: 'Correção OMR',
    items: [
      { view: 'correct-card', label: 'Nova leitura', icon: ScanLine },
      { view: 'pending', label: 'Revisões pendentes', icon: ClipboardCheck },
      { view: 'results', label: 'Histórico de correções', icon: History },
    ],
  },
  {
    id: 'analises',
    label: 'Análises e desempenho',
    items: [
      { view: 'dashboard', label: 'Resultados', icon: BarChart3 },
      { view: 'reports', label: 'Relatórios', icon: FileText },
      { view: 'lab', label: 'Banco de testes OMR', icon: FlaskConical },
    ],
  },
  {
    id: 'admin',
    label: 'Administração',
    items: [
      { view: 'settings', label: 'Configurações', icon: Settings },
      { view: 'admin-users', label: 'Usuários', icon: ShieldCheck, adminOnly: true },
      { view: 'profile', label: 'Perfil do usuário', icon: UserRound },
      { view: 'help', label: 'Ajuda e suporte', icon: LifeBuoy },
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
  { view: 'avaliacoes', label: 'Avaliações', icon: ListChecks },
  { view: 'correct-card', label: 'Nova leitura', icon: ScanLine },
  { view: 'pending', label: 'Revisões', icon: ClipboardCheck },
  { view: 'dashboard', label: 'Resultados', icon: BarChart3 },
];

/** Título + grupo para TODAS as views (inclusive as fora da sidebar). */
export const VIEW_META: Record<AppView, { title: string; group: string }> = {
  home: { title: 'Painel inicial', group: 'Painel' },
  avaliacoes: { title: 'Gerenciar avaliações', group: 'Avaliações' },
  'avaliacao-detalhe': { title: 'Detalhe da avaliação', group: 'Avaliações' },
  'new-exam': { title: 'Provas e avaliações', group: 'Avaliações' },
  provas: { title: 'Gabaritos', group: 'Avaliações' },
  turmas: { title: 'Turmas', group: 'Gestão escolar' },
  alunos: { title: 'Alunos', group: 'Gestão escolar' },
  'generate-card': { title: 'Gerar cartões-resposta', group: 'Avaliações' },
  'custom-template': { title: 'Gabaritos personalizados', group: 'Avaliações' },
  'import-students': { title: 'Cartões por lista da prova', group: 'Avaliações' },
  'manage-exam': { title: 'Detalhe da avaliação', group: 'Avaliações' },
  'register-key': { title: 'Gabaritos', group: 'Avaliações' },
  'correct-card': { title: 'Nova leitura', group: 'Correção OMR' },
  results: { title: 'Histórico de correções', group: 'Correção OMR' },
  pending: { title: 'Revisões pendentes', group: 'Correção OMR' },
  dashboard: { title: 'Resultados', group: 'Análises e desempenho' },
  reports: { title: 'Relatórios', group: 'Análises e desempenho' },
  lab: { title: 'Banco de testes OMR', group: 'Análises e desempenho' },
  'view-result': { title: 'Detalhe da correção', group: 'Correção OMR' },
  settings: { title: 'Configurações', group: 'Administração' },
  help: { title: 'Ajuda e suporte', group: 'Administração' },
  profile: { title: 'Perfil do usuário', group: 'Administração' },
  'admin-users': { title: 'Usuários', group: 'Administração' },
};

/** Páginas de trabalho intensivo usam a largura total do monitor. */
export const WIDE_VIEWS: AppView[] = [
  'correct-card', 'avaliacoes', 'avaliacao-detalhe', 'manage-exam', 'results', 'dashboard',
  'lab', 'view-result', 'custom-template', 'reports',
];

export function viewMeta(view: AppView): { title: string; group: string } {
  return VIEW_META[view];
}
