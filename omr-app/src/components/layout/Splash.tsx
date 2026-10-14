import { ScanSearch } from 'lucide-react';

/** Tela de abertura brandida (exibida enquanto a sessão é validada). */
export default function Splash() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-navy-900 px-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-brand-500 flex items-center justify-center mb-5 shadow-modal">
        <ScanSearch size={40} strokeWidth={2} className="text-white" aria-hidden />
      </div>
      <p className="text-3xl font-bold text-white tracking-tight">Gabarito+</p>
      <p className="text-sm text-brand-100 mt-2 max-w-[260px]">
        Criação, leitura e correção de gabaritos com tecnologia OMR
      </p>
      <div
        className="mt-8 w-10 h-10 border-4 border-white/25 border-t-white rounded-full animate-spin"
        role="status"
        aria-label="Carregando"
      />
    </div>
  );
}
