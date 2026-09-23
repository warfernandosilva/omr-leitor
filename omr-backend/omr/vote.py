"""Votação multi-frame: N leituras do mesmo cartão viram 1 resultado.

Divergência entre frames vira low_confidence (conferência manual) em
vez de erro silencioso — foto tremida/luz variando lê diferente por
frame; a votação extrai o consenso e sinaliza o resto.

Regras (N=1 reproduz exatamente o frame único):
1. frames com vencedor claro ('ok'): maioria entre eles — empate cai no
   primeiro; se não houver unanimidade OU qualquer outro frame divergiu
   (blank/dup/low), o resultado mantém a resposta mas vira low_conf;
2. sem 'ok': maioria 'duplicate' (marcas unidas) senão maioria 'low';
3. senão blank.
"""
from collections import Counter

from .reader import OMRResult


def _frame_status(r: OMRResult, q: int) -> tuple[str, str | None]:
    if q in r.duplicate_questions:
        return "dup", None
    if q in r.blank_questions:
        return "blank", None
    letter = r.answers.get(q)
    if q in r.low_confidence:
        return "low", letter
    if letter:
        return "ok", letter
    return "blank", None


def vote_frames(results: list[OMRResult]) -> OMRResult | None:
    """Vota por questão. Devolve None se nenhuma leitura veio."""
    good = [r for r in results if r is not None]
    if not good:
        return None
    if len(good) == 1:
        return good[0]

    questions: set[int] = set()
    for r in good:
        questions.update(r.answers.keys())
        questions.update(r.blank_questions)
        questions.update(r.duplicate_questions)

    answers: dict[int, str] = {}
    blank: list[int] = []
    duplicates: list[int] = []
    dup_marks: dict[int, list[str]] = {}
    low_conf: list[int] = []

    for q in sorted(questions):
        statuses = [_frame_status(r, q) for r in good]
        ok_letters = [l for s, l in statuses if s == "ok" and l]
        if ok_letters:
            top_letter, top_count = Counter(ok_letters).most_common(1)[0]
            unanimous = len(set(ok_letters)) == 1
            others_diverge = any(s != "ok" for s, _ in statuses)
            answers[q] = top_letter
            if not unanimous or others_diverge:
                low_conf.append(q)  # resposta mantida, conferência sugerida
        else:
            dup_n = sum(1 for s, _ in statuses if s == "dup")
            low_letters = [l for s, l in statuses if s == "low" and l]
            if dup_n > len(good) / 2:
                duplicates.append(q)
                for r in good:
                    if q in (r.duplicate_marks or {}):
                        dup_marks[q] = list(r.duplicate_marks[q])  # type: ignore[index]
                        break
            elif low_letters:
                top_letter, _ = Counter(low_letters).most_common(1)[0]
                low_conf.append(q)
                answers[q] = top_letter
            else:
                blank.append(q)

    first = good[0]
    return OMRResult(
        answers=answers,
        blank_questions=blank,
        duplicate_questions=duplicates,
        low_confidence=low_conf,
        all_ratios=first.all_ratios,
        rectified=first.rectified,
        qr_id=next((r.qr_id for r in good if r.qr_id), None),
        duplicate_marks=dup_marks,
        floor_used=first.floor_used,
        floor_source=first.floor_source,
        t_detect=sum(r.t_detect for r in good),
        t_warp=sum(r.t_warp for r in good),
        t_qr=sum(r.t_qr for r in good),
        t_score=sum(r.t_score for r in good),
    )
