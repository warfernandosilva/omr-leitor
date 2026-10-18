import { useState, useCallback, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppView } from './types';
import AppShell from './components/layout/AppShell';
import Splash from './components/layout/Splash';
import { WIDE_VIEWS } from './components/layout/nav';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { saveNav, loadNav, saveSidebarCollapsed, loadSidebarCollapsed } from './utils/nav-persist';
import { initPwa, applyPwaUpdate, PWA_UPDATE_EVENT } from './pwa';
import HomePage from './pages/HomePage';
import NewExamPage from './pages/NewExamPage';
import TurmasPage from './pages/TurmasPage';
import StudentsPage from './pages/StudentsPage';
import PendingReviewsPage from './pages/PendingReviewsPage';
import SettingsPage from './pages/SettingsPage';
import HelpPage from './pages/HelpPage';
import ReportsPage from './pages/ReportsPage';
import GenerateCardPage from './pages/GenerateCardPage';
import CustomTemplatePage from './pages/CustomTemplatePage';
import RosterCardsPage from './pages/RosterCardsPage';
import ManageExamPage from './pages/ManageExamPage';
import RegisterKeyPage from './pages/RegisterKeyPage';
import CorrectCardPage from './pages/CorrectCardPage';
import ResultsPage from './pages/ResultsPage';
import DashboardPage from './pages/DashboardPage';
import LabPage from './pages/LabPage';
import ViewResultPage from './pages/ViewResultPage';
import AdminUsersPage from './pages/AdminUsersPage';
import ProfilePage from './pages/ProfilePage';
import LoginPage from './pages/LoginPage';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, token, loading } = useAuth();
  if (loading) {
    return <Splash />;
  }
  if (!token || !user) {
    return <LoginPage />;
  }
  return <>{children}</>;
}

function AppInner() {
  // Restaura a tela após reload (ex.: volta da câmera nativa no Android)
  const [view, setView] = useState<AppView>(() => loadNav()?.view ?? 'home');
  const [selectedExamId, setSelectedExamId] = useState<string | null>(
    () => loadNav()?.examId ?? null,
  );
  const [selectedResultId, setSelectedResultId] = useState<string | null>(
    () => loadNav()?.resultId ?? null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => loadSidebarCollapsed());
  const [pwaUpdate, setPwaUpdate] = useState(false);
  // Entrada de histórico empurrada ao abrir o drawer (para o botão voltar
  // do Android fechar o menu em vez de sair do app).
  const drawerPushedRef = useRef(false);

  useEffect(() => {
    initPwa();
    const onUpdate = () => setPwaUpdate(true);
    window.addEventListener(PWA_UPDATE_EVENT, onUpdate);
    return () => window.removeEventListener(PWA_UPDATE_EVENT, onUpdate);
  }, []);

  useEffect(() => {
    saveNav({ view, examId: selectedExamId, resultId: selectedResultId });
  }, [view, selectedExamId, selectedResultId]);

  // Drawer + botão voltar: abrir empurra uma entrada; voltar fecha o menu.
  useEffect(() => {
    if (drawerOpen && !drawerPushedRef.current) {
      try {
        window.history.pushState({ omrDrawer: true }, '');
        drawerPushedRef.current = true;
      } catch {
        /* histórico indisponível — segue sem fechar no voltar */
      }
    }
    const onPop = () => {
      drawerPushedRef.current = false;
      setDrawerOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [drawerOpen]);

  const closeDrawer = useCallback(() => {
    if (drawerPushedRef.current) {
      // Consome a entrada empurrada; o 'popstate' fecha o drawer.
      drawerPushedRef.current = false;
      window.history.back();
    } else {
      setDrawerOpen(false);
    }
  }, []);

  const navigate = useCallback((v: AppView, examId?: string, resultId?: string) => {
    setView(v);
    // Na tela de detalhe, o primeiro id recebido é o do RESULTADO (ResultsPage
    // chama onNavigate('view-result', r.id)) — não confundir com examId.
    if (v === 'view-result') {
      const rid = resultId ?? examId;
      if (rid) setSelectedResultId(rid);
    } else {
      if (examId) setSelectedExamId(examId);
      if (resultId) setSelectedResultId(resultId);
    }
    setDrawerOpen(false);
    window.scrollTo(0, 0);
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      saveSidebarCollapsed(!prev);
      return !prev;
    });
  }, []);

  const renderView = () => {
    switch (view) {
      case 'home':
        return <HomePage onNavigate={navigate} />;
      case 'new-exam':
        return <NewExamPage onNavigate={navigate} />;
      case 'turmas':
        return <TurmasPage onNavigate={navigate} />;
      case 'alunos':
        return <StudentsPage onNavigate={navigate} />;
      case 'pending':
        return <PendingReviewsPage onNavigate={navigate} />;
      case 'reports':
        return <ReportsPage onNavigate={navigate} />;
      case 'settings':
        return <SettingsPage onNavigate={navigate} />;
      case 'help':
        return <HelpPage onNavigate={navigate} />;
      case 'generate-card':
        return <GenerateCardPage examId={selectedExamId} onNavigate={navigate} />;
      case 'custom-template':
        return <CustomTemplatePage />;
      case 'import-students':
        return <RosterCardsPage examId={selectedExamId} onNavigate={navigate} />;
      case 'manage-exam':
        return <ManageExamPage examId={selectedExamId} onNavigate={navigate} />;
      case 'register-key':
        return <RegisterKeyPage examId={selectedExamId} onNavigate={navigate} />;
      case 'correct-card':
        return <CorrectCardPage examId={selectedExamId} onNavigate={navigate} />;
      case 'results':
        return <ResultsPage onNavigate={navigate} />;
      case 'dashboard':
        return <DashboardPage onNavigate={navigate} />;
      case 'lab':
        return <LabPage onNavigate={navigate} />;
      case 'view-result':
        return <ViewResultPage resultId={selectedResultId} onNavigate={navigate} />;
      case 'admin-users':
        return <AdminUsersPage onNavigate={navigate} />;
      case 'profile':
        return <ProfilePage onNavigate={navigate} />;
      default:
        return <HomePage onNavigate={navigate} />;
    }
  };

  return (
    <AppShell
      currentView={view}
      onNavigate={navigate}
      examId={selectedExamId}
      wide={WIDE_VIEWS.includes(view)}
      collapsed={collapsed}
      onToggleCollapse={toggleCollapse}
      drawerOpen={drawerOpen}
      onOpenDrawer={() => setDrawerOpen(true)}
      onCloseDrawer={closeDrawer}
    >
      <ErrorBoundary>{renderView()}</ErrorBoundary>
      {pwaUpdate && (
        <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-brand-600 text-white rounded-xl shadow-lg p-4 flex items-center gap-3">
          <span className="text-sm flex-1">Nova versão do app disponível.</span>
          <button
            onClick={() => applyPwaUpdate()}
            className="bg-white text-brand-700 text-sm font-bold px-4 py-2 rounded-lg min-h-[44px]"
          >
            Atualizar
          </button>
          <button
            onClick={() => setPwaUpdate(false)}
            className="text-brand-100 text-sm px-2 py-2 min-h-[44px]"
          >
            Depois
          </button>
        </div>
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </AuthGate>
    </AuthProvider>
  );
}
