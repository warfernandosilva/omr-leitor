"""Sanity pós-leitura: barra lixo antes de responder (alto valor, barato).

Foto de outro modelo/versão de cartão gera dezenas de "duplicadas"
fantasmas (caso real: layout antigo, 28/44). Sem o gate, o modo lote
salva esse lixo automaticamente. Regras:
- duplicadas > DUP_MAX_FRAC da prova -> BLOQUEIA (sucesso=False) com
  erro orientador — quase sempre modelo/versão errado ou foto ruim;
- muitas em branco -> aviso em warnings[] (cartão em branco de aluno
  ausente é resultado legítimo, não lixo — por isso não bloqueia);
- baixa confiança -> aviso em warnings[].
"""
from dataclasses import dataclass

DUP_MAX_FRAC = 0.30
BLANK_WARN_FRAC = 0.50


@dataclass
class SanityResult:
    ok: bool
    message: str | None  # erro orientador quando ok=False
    warnings: list[str]


def _fmt_qs(qs: list[int], limit: int = 10) -> str:
    head = ", ".join(str(q) for q in qs[:limit])
    return head + ("…" if len(qs) > limit else "")


def sanity_check(
    dup_questions: list[int],
    blank_questions: list[int],
    low_confidence: list[int],
    total_questions: int,
) -> SanityResult:
    n = max(1, total_questions)
    warnings: list[str] = []

    if low_confidence:
        warnings.append(
            f"{len(low_confidence)} questão(ões) com baixa confiança "
            f"(Q{_fmt_qs(low_confidence)}) — confira manualmente antes de salvar."
        )

    blank_frac = len(blank_questions) / n
    if blank_frac >= BLANK_WARN_FRAC:
        warnings.append(
            f"Leitura com {len(blank_questions)} questões em branco ({blank_frac:.0%}): "
            "confira se o cartão está de frente, nítido e do modelo certo."
        )

    dup_frac = len(dup_questions) / n
    if dup_frac > DUP_MAX_FRAC:
        return SanityResult(
            ok=False,
            message=(
                f"Leitura suspeita: {len(dup_questions)} questões com dupla marcação "
                f"({dup_frac:.0%} da prova). Isso normalmente indica foto de outro "
                "modelo/versão de cartão ou foto ruim. Confira o cartão e capture novamente."
            ),
            warnings=warnings,
        )

    return SanityResult(ok=True, message=None, warnings=warnings)
