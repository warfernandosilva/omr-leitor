import { useState, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppView } from './types';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ui/ThemeToggle';
import { ErrorBoundary } from './components/ErrorBoundary';
import HomePage from './pages/HomePage';
import NewExamPage from './pages/NewExamPage';
import GenerateCardPage from './pages/GenerateCardPage';
import RosterCardsPage from './pages/RosterCardsPage';
import ManageExamPage from './pages/ManageExamPage';
import RegisterKeyPage from './pages/RegisterKeyPage';
import CorrectCardPage from './pages/CorrectCardPage';
import ResultsPage from './pages/ResultsPage';
import DashboardPage from './pages/DashboardPage';
import ViewResultPage from './pages/ViewResultPage';
import AdminUsersPage from './pages/AdminUsersPage';
import LoginPage from './pages/LoginPage';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, token, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }
  if (!token || !user) {
    return <LoginPage />;
  }
  return <>{children}</>;
}

function AppInner() {
  const [view, setView] = useState<AppView>('home');
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
    setSidebarOpen(false);
    window.scrollTo(0, 0);
  }, []);

  const renderView = () => {
    switch (view) {
      case 'home':
        return <HomePage onNavigate={navigate} />;
      case 'new-exam':
        return <NewExamPage onNavigate={navigate} />;
      case 'generate-card':
        return <GenerateCardPage examId={selectedExamId} onNavigate={navigate} />;
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
      case 'view-result':
        return <ViewResultPage resultId={selectedResultId} onNavigate={navigate} />;
      case 'admin-users':
        return <AdminUsersPage onNavigate={navigate} />;
      default:
        return <HomePage onNavigate={navigate} />;
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50 dark:bg-gray-950">
      <Sidebar
        currentView={view}
        onNavigate={navigate}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />
      <main className="flex-1 min-h-screen lg:ml-64">
        <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[44px] min-w-[44px]" aria-label="Abrir menu">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">OMR Correção</h1>
          <div className="ml-auto"><ThemeToggle /></div>
        </div>
        <div className="p-4 md:p-6 lg:p-8 max-w-6xl mx-auto animate-fade-in">
          <ErrorBoundary>{renderView()}</ErrorBoundary>
        </div>
      </main>
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate>
        <AppInner />
      </AuthGate>
    </AuthProvider>
  );
}
