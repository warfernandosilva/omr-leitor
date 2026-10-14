from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .lab_read import run_lab_pipeline, collect_option_metrics


GOLDEN_DIR = Path(__file__).resolve().parent.parent / "golden"


@dataclass
class GoldenCase:
    model: str
    case_id: str
    image_path: Path
    labels: dict[str, str]


def _normalize_labels(labels: dict[str, Any]) -> dict[str, str]:
    normalized = {}
    for k, v in labels.items():
        if not isinstance(v, str):
            raise ValueError(f"label value for question {k} must be string, got {type(v).__name__}")
        normalized[k.strip()] = v.strip().upper()
    return dict(sorted(normalized.items()))


def _model_dir(model: str) -> Path:
    return GOLDEN_DIR / model


def list_cases(model: str) -> list[str]:
    model_path = _model_dir(model)
    if not model_path.exists() or not model_path.is_dir():
        return []
    return sorted(
        d.name
        for d in model_path.iterdir()
        if d.is_dir() and (d / "original.png").exists() and (d / "labels.json").exists()
    )


def load_case(model: str, case_id: str) -> GoldenCase:
    case_path = _model_dir(model) / case_id
    image_path = case_path / "original.png"
    labels_path = case_path / "labels.json"

    if not image_path.exists():
        raise FileNotFoundError(f"original.png not found for case {case_id} in model {model}")
    if not labels_path.exists():
        raise FileNotFoundError(f"labels.json not found for case {case_id} in model {model}")

    with labels_path.open("r", encoding="utf-8") as f:
        labels = _normalize_labels(json.load(f))

    return GoldenCase(model=model, case_id=case_id, image_path=image_path, labels=labels)


def save_case(model: str, case_id: str, image_bytes: bytes, labels: dict[str, str]) -> Path:
    case_path = _model_dir(model) / case_id
    case_path.mkdir(parents=True, exist_ok=True)

    image_path = case_path / "original.png"
    labels_path = case_path / "labels.json"

    image_path.write_bytes(image_bytes)

    normalized = _normalize_labels(labels)
    with labels_path.open("w", encoding="utf-8") as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)

    return case_path


@dataclass
class GoldenReport:
    model: str
    total_cases: int
    evaluated: int
    accuracy: float
    mismatches: dict[str, list[dict[str, str]]]
    blanks: dict[str, list[str]]


def evaluate_golden(model: str, overrides: dict[str, Any] | None = None, cases: list[str] | None = None) -> GoldenReport:
    case_ids = cases if cases is not None else list_cases(model)

    if not case_ids:
        print(f"no cases for model {model}")
        return GoldenReport(model=model, total_cases=0, evaluated=0, accuracy=0.0, mismatches={}, blanks={})

    total_questions = 0
    correct_questions = 0
    mismatches: dict[str, list[dict[str, str]]] = {}
    blanks: dict[str, list[str]] = {}

    for case_id in case_ids:
        case = load_case(model, case_id)

        with case.image_path.open("rb") as f:
            image_bytes = f.read()

        result = run_lab_pipeline(image_bytes, case.model, overrides=overrides)

        option_metrics = collect_option_metrics(result)

        for q_num, expected_letter in case.labels.items():
            total_questions += 1
            q_key = q_num.strip()

            metrics = option_metrics.get(q_key)
            if not metrics:
                blanks.setdefault(case_id, []).append(q_key)
                continue

            best_letter = max(metrics, key=lambda l: metrics[l].dark_ratio)
            if best_letter == expected_letter:
                correct_questions += 1
            else:
                mismatches.setdefault(case_id, []).append({
                    "question": q_key,
                    "expected": expected_letter,
                    "got": best_letter,
                })

    accuracy = correct_questions / total_questions if total_questions > 0 else 0.0

    return GoldenReport(
        model=model,
        total_cases=len(case_ids),
        evaluated=total_questions,
        accuracy=accuracy,
        mismatches=mismatches,
        blanks=blanks,
    )


def _print_report(report: GoldenReport) -> None:
    print(f"Model: {report.model}")
    print(f"Cases: {report.total_cases}")
    print(f"Questions evaluated: {report.evaluated}")
    print(f"Accuracy: {report.accuracy:.2%}")
    if report.mismatches:
        print("\nMismatches:")
        for case_id, ms in report.mismatches.items():
            for m in ms:
                print(f"  {case_id} q{m['question']}: expected {m['expected']}, got {m['got']}")
    if report.blanks:
        print("\nBlanks (no metrics):")
        for case_id, qs in report.blanks.items():
            for q in qs:
                print(f"  {case_id} q{q}")


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate OMR golden cases")
    parser.add_argument("--model", default="herby", help="Model name (default: herby)")
    parser.add_argument("--case", help="Specific case ID to evaluate")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of human-readable summary")
    args = parser.parse_args()

    case_ids = [args.case] if args.case else None
    report = evaluate_golden(args.model, cases=case_ids)

    if args.json:
        print(json.dumps({
            "model": report.model,
            "total_cases": report.total_cases,
            "evaluated": report.evaluated,
            "accuracy": report.accuracy,
            "mismatches": report.mismatches,
            "blanks": report.blanks,
        }, ensure_ascii=False, indent=2))
    else:
        _print_report(report)


if __name__ == "__main__":
    main()