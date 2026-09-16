import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('omr-theme');
    const isDark = saved === 'dark';
    setDark(isDark);
    document.documentElement.classList.toggle('dark', isDark);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('omr-theme', next ? 'dark' : 'light');
  };

  return (
    <button
      onClick={toggle}
      className="btn btn-secondary btn-sm min-h-[44px]"
      aria-label={dark ? 'Ativar modo claro' : 'Ativar modo escuro'}
      aria-pressed={dark}
    >
      {dark ? '☀️ Claro' : '🌙 Escuro'}
    </button>
  );
}
