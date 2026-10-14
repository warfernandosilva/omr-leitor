from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from omr.golden import (
    GoldenCase,
    list_cases,
    load_case,
    save_case,
    evaluate_golden,
    _normalize_labels,
    GOLDEN_DIR,
)


class TestNormalizeLabels:
    def test_normalize_labels_basic(self):
        labels = {"1": "a", "2": "B", " 3 ": " c "}
        result = _normalize_labels(labels)
        assert result == {"1": "A", "2": "B", "3": "C"}

    def test_normalize_labels_non_string_raises(self):
        labels = {"1": "A", "2": 42}
        with pytest.raises(ValueError, match="must be string"):
            _normalize_labels(labels)

    def test_normalize_labels_sorted_keys(self):
        labels = {"3": "A", "1": "B", "2": "C"}
        result = _normalize_labels(labels)
        assert list(result.keys()) == ["1", "2", "3"]


class TestSaveLoadRoundTrip:
    def test_save_and_load_case(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                image_bytes = b"fake png content"
                labels = {"1": "A", "2": "B", "3": "C"}

                save_case("herby", "case_001", image_bytes, labels)

                case_ids = list_cases("herby")
                assert case_ids == ["case_001"]

                case = load_case("herby", "case_001")
                assert case.model == "herby"
                assert case.case_id == "case_001"
                assert case.image_path.read_bytes() == image_bytes
                assert case.labels == {"1": "A", "2": "B", "3": "C"}
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_save_case_creates_nested_dirs(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                save_case("herby", "nested/deep/case_002", b"img", {"1": "A"})
                case = load_case("herby", "nested/deep/case_002")
                assert case.case_id == "nested/deep/case_002"
                assert case.labels == {"1": "A"}
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_save_case_overwrites_existing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                save_case("herby", "case_003", b"v1", {"1": "A"})
                save_case("herby", "case_003", b"v2", {"2": "B"})
                case = load_case("herby", "case_003")
                assert case.image_path.read_bytes() == b"v2"
                assert case.labels == {"2": "B"}
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir


class TestListCases:
    def test_list_cases_empty_model_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                assert list_cases("herby") == []
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_list_cases_ignores_incomplete_cases(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                (golden_dir / "herby" / "complete").mkdir(parents=True)
                (golden_dir / "herby" / "complete" / "original.png").write_bytes(b"")
                (golden_dir / "herby" / "complete" / "labels.json").write_text("{}")

                (golden_dir / "herby" / "missing_image").mkdir(parents=True)
                (golden_dir / "herby" / "missing_image" / "labels.json").write_text("{}")

                (golden_dir / "herby" / "missing_labels").mkdir(parents=True)
                (golden_dir / "herby" / "missing_labels" / "original.png").write_bytes(b"")

                (golden_dir / "herby" / "not_a_dir.txt").write_text("")

                assert list_cases("herby") == ["complete"]
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir


class TestLoadCaseErrors:
    def test_load_case_missing_image_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                (golden_dir / "herby" / "case_missing_img").mkdir(parents=True)
                (golden_dir / "herby" / "case_missing_img" / "labels.json").write_text("{}")

                with pytest.raises(FileNotFoundError, match="original.png not found"):
                    load_case("herby", "case_missing_img")
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_load_case_missing_labels_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                (golden_dir / "herby" / "case_missing_labels").mkdir(parents=True)
                (golden_dir / "herby" / "case_missing_labels" / "original.png").write_bytes(b"")

                with pytest.raises(FileNotFoundError, match="labels.json not found"):
                    load_case("herby", "case_missing_labels")
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_load_case_malformed_labels_raises(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                (golden_dir / "herby" / "case_bad_labels").mkdir(parents=True)
                (golden_dir / "herby" / "case_bad_labels" / "original.png").write_bytes(b"")
                (golden_dir / "herby" / "case_bad_labels" / "labels.json").write_text("not a dict")

                with pytest.raises(ValueError):
                    load_case("herby", "case_bad_labels")
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir


class TestEvaluateGolden:
    def test_evaluate_golden_empty_corpus(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                report = evaluate_golden("herby")
                assert report.total_cases == 0
                assert report.evaluated == 0
                assert report.accuracy == 0.0
                assert report.mismatches == {}
                assert report.blanks == {}
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_evaluate_golden_synthetic_case(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                save_case("herby", "synth_1", b"fake", {"1": "A", "2": "B"})

                fake_result = MagicMock()
                fake_result.answers = {"1": "A", "2": "B"}

                fake_metrics = {
                    "1": {"A": MagicMock(dark_ratio=0.5), "B": MagicMock(dark_ratio=0.1), "C": MagicMock(dark_ratio=0.1), "D": MagicMock(dark_ratio=0.1)},
                    "2": {"A": MagicMock(dark_ratio=0.1), "B": MagicMock(dark_ratio=0.6), "C": MagicMock(dark_ratio=0.1), "D": MagicMock(dark_ratio=0.1)},
                }

                with patch("omr.golden.run_lab_pipeline", return_value=fake_result), \
                     patch("omr.golden.collect_option_metrics", return_value=fake_metrics):
                    report = evaluate_golden("herby")

                assert report.total_cases == 1
                assert report.evaluated == 2
                assert report.accuracy == 1.0
                assert report.mismatches == {}
                assert report.blanks == {}
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_evaluate_golden_mismatch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                save_case("herby", "synth_2", b"fake", {"1": "A"})

                fake_result = MagicMock()
                fake_result.answers = {"1": "B"}

                fake_metrics = {
                    "1": {"A": MagicMock(dark_ratio=0.1), "B": MagicMock(dark_ratio=0.6), "C": MagicMock(dark_ratio=0.1), "D": MagicMock(dark_ratio=0.1)},
                }

                with patch("omr.golden.run_lab_pipeline", return_value=fake_result), \
                     patch("omr.golden.collect_option_metrics", return_value=fake_metrics):
                    report = evaluate_golden("herby")

                assert report.accuracy == 0.0
                assert "synth_2" in report.mismatches
                assert report.mismatches["synth_2"][0]["expected"] == "A"
                assert report.mismatches["synth_2"][0]["got"] == "B"
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir

    def test_evaluate_golden_blank(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            golden_dir = Path(tmpdir) / "golden"
            import omr.golden as golden_module
            original_golden_dir = golden_module.GOLDEN_DIR
            golden_module.GOLDEN_DIR = golden_dir

            try:
                save_case("herby", "synth_3", b"fake", {"1": "A"})

                fake_result = MagicMock()
                fake_result.answers = {}

                fake_metrics = {}

                with patch("omr.golden.run_lab_pipeline", return_value=fake_result), \
                     patch("omr.golden.collect_option_metrics", return_value=fake_metrics):
                    report = evaluate_golden("herby")

                assert report.accuracy == 0.0
                assert "synth_3" in report.blanks
                assert report.blanks["synth_3"] == ["1"]
            finally:
                golden_module.GOLDEN_DIR = original_golden_dir


class TestGoldenCaseDataclass:
    def test_golden_case_structure(self):
        case = GoldenCase(model="herby", case_id="test", image_path=Path("/tmp/img.png"), labels={"1": "A"})
        assert case.model == "herby"
        assert case.case_id == "test"
        assert case.labels == {"1": "A"}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])