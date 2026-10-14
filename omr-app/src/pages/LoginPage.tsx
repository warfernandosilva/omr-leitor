import { useState } from 'react';
import type { FormEvent } from 'react';
import { LogIn, ScanSearch, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getApiBase, testConnection, ConnectionTest } from '../utils/api';
import Card from '../components/ui/Card';
import Field from '../components/ui/Field';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [connTest, setConnTest] = useState<ConnectionTest | null>(null);
  const [testing, setTesting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Preencha e-mail e senha.');
      return;
    }
    if (mode === 'register' && !nome.trim()) {
      setError('Informe seu nome.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), nome.trim(), password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha na autenticação.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface dark:bg-navy-950 relative overflow-hidden">
      <div aria-hidden className="absolute -top-32 left-1/2 -translate-x-1/2 w-[560px] h-[280px] bg-brand-500/10 blur-3xl rounded-full pointer-events-none" />
      {/* Faixa de identidade */}
      <div className="bg-navy-900 px-4 pt-10 pb-8 text-center relative">
        <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-3 shadow-card">
          <ScanSearch size={28} strokeWidth={2} className="text-white" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-white">Gabarito+</h1>
        <p className="text-sm text-brand-100 mt-1">
          Criação, leitura e correção de gabaritos com tecnologia OMR
        </p>
      </div>

      <div className="flex-1 flex items-start justify-center px-4 py-6">
      <div className="w-full max-w-md relative">
        <div className="text-center mb-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {mode === 'login' ? 'Entre com sua conta' : 'Crie sua conta — o primeiro usuário vira administrador'}
          </p>
        </div>

        <Card>
          <div role="tablist" aria-label="Entrar ou registrar" className="flex gap-1 p-1 mb-5 rounded-lg bg-surface dark:bg-gray-800">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => { setMode('login'); setError(null); }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors min-h-[40px] ${
                mode === 'login'
                  ? 'bg-white text-brand-700 shadow-card dark:bg-gray-900 dark:text-brand-200'
                  : 'text-gray-500 hover:text-ink dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <LogIn size={15} aria-hidden />
              Entrar
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => { setMode('register'); setError(null); }}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors min-h-[40px] ${
                mode === 'register'
                  ? 'bg-white text-brand-700 shadow-card dark:bg-gray-900 dark:text-brand-200'
                  : 'text-gray-500 hover:text-ink dark:text-gray-400 dark:hover:text-white'
              }`}
            >
              <UserPlus size={15} aria-hidden />
              Registrar
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <Field label="E-mail" htmlFor="login-email" required>
              <Input
                id="login-email"
                type="email"
                placeholder="professor@escola.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
              />
            </Field>
            {mode === 'register' && (
              <Field label="Nome" htmlFor="login-nome" required>
                <Input
                  id="login-nome"
                  type="text"
                  placeholder="Seu nome"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  autoComplete="name"
                />
              </Field>
            )}
            <Field label="Senha" htmlFor="login-senha" required>
              <Input
                id="login-senha"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </Field>

            {error && (
              <div role="alert" className="callout-danger">
                {error}
              </div>
            )}

            <Button type="submit" loading={submitting} className="w-full">
              {mode === 'login' ? 'Entrar' : 'Criar conta'}
            </Button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-4">
            Ao registrar, o primeiro usuário do sistema torna-se administrador automaticamente.
          </p>

          <div className="mt-4 pt-3 border-t border-line dark:border-gray-800">
            <p className="text-xs text-gray-400 text-center break-all">API: {getApiBase() || '(mesma origem)'}/api</p>
            <button
              type="button"
              disabled={testing}
              onClick={async () => { setTesting(true); setConnTest(null); setConnTest(await testConnection()); setTesting(false); }}
              className="mt-2 w-full text-xs text-brand-600 hover:text-brand-700 disabled:text-gray-400 dark:text-brand-200"
            >
              {testing ? 'Testando...' : 'Testar conexão com a API'}
            </button>
            {connTest && (
              <p className={`mt-1 text-xs text-center ${connTest.ok ? 'text-success-600' : 'text-danger-600'}`}>
                {connTest.ok ? `✔ ${connTest.detail}` : `✖ ${connTest.detail}`}
              </p>
            )}
          </div>
        </Card>
        <p className="text-[11px] text-gray-400 text-center mt-4">v1.0 — Gabarito+</p>
      </div>
      </div>
    </div>
  );
}
