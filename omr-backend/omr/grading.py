"""
Correção de respostas: compara OMR result com gabarito oficial.
"""

from __future__ import annotations

from dataclasses import dataclass

from .reader import OMRResult


@dataclass
class SubjectStats:
    correct: int
    incorrect: int
    blank: int
    duplicate: int
    total: int
    grade: float


@dataclass
class GradingResult:
    portugues: SubjectStats
    matematica: SubjectStats
    total_correct: int
    total_incorrect: int
    total_blank: int
    total_duplicate: int
    total_questions: int


def calculate_grade(correct: int, total: int, scale: str) -> float:
    """Calcula nota conforme escala."""
    if total == 0:
        return 0.0
    if scale == "0-10":
        return round((correct / total) * 10, 1)
    elif scale == "0-100":
        return round((correct / total) * 100, 1)
    else:
        return float(correct)


def grade(
    omr: OMRResult,
    answer_key: dict[int, str],
    grade_scale: str = "0-10",
    questions_per_subject: int = 22,
    layout_mode: str = "dual",
) -> GradingResult:
    """
    Corrige as respostas OMR contra o gabarito.

    answer_key: {1: 'A', 2: 'B', ...}
    layout_mode 'single': questões 1..questions_per_subject (todas na 1ª disciplina).
    """
    qps = max(1, int(questions_per_subject))
    single = layout_mode == "single"
    total_q = qps if single else qps * 2

    lp_correct = lp_incorrect = lp_blank = lp_dup = 0
    mat_correct = mat_incorrect = mat_blank = mat_dup = 0

    for q in range(1, total_q + 1):
        expected = answer_key.get(q)
        is_lp = True if single else q <= qps

        if q in omr.duplicate_questions:
            # Política: marcação dupla é EXIBIDA como alerta e conta como ERRO.
            # O contador *_dup permanece apenas como sub-informação de erros.
            if is_lp:
                lp_incorrect += 1
                lp_dup += 1
            else:
                mat_incorrect += 1
                mat_dup += 1
            continue

        if q in omr.blank_questions or expected is None:
            if is_lp:
                lp_blank += 1
            else:
                mat_blank += 1
            continue

        got = omr.answers.get(q)
        if got is None:
            if is_lp:
                lp_blank += 1
            else:
                mat_blank += 1
        elif got == expected:
            if is_lp:
                lp_correct += 1
            else:
                mat_correct += 1
        else:
            if is_lp:
                lp_incorrect += 1
            else:
                mat_incorrect += 1

    lp_total = total_q if single else qps
    mat_total = 0 if single else qps

    lp = SubjectStats(
        correct=lp_correct,
        incorrect=lp_incorrect,
        blank=lp_blank,
        duplicate=lp_dup,
        total=lp_total,
        grade=calculate_grade(lp_correct, lp_total, grade_scale),
    )
    mat = SubjectStats(
        correct=mat_correct,
        incorrect=mat_incorrect,
        blank=mat_blank,
        duplicate=mat_dup,
        total=mat_total,
        grade=calculate_grade(mat_correct, mat_total, grade_scale),
    )

    return GradingResult(
        portugues=lp,
        matematica=mat,
        total_correct=lp_correct + mat_correct,
        total_incorrect=lp_incorrect + mat_incorrect,
        total_blank=lp_blank + mat_blank,
        total_duplicate=lp_dup + mat_dup,
        total_questions=lp_total + mat_total,
    )
