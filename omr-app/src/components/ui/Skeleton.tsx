interface Props {
  className?: string;
}

/** Carregamento esqueletal (mesmo formato do conteúdo final, não spinner genérico). */
export default function Skeleton({ className = '' }: Props) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}
