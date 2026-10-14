from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from omr.params import (
    OmrParams,
    _config_hash,
    write_active_config,
    clear_active_config,
    get_active_config_with_meta,
    params_diff,
    list_active_config_history,
    _save_history_entry,
)
from omr.lab_metrics import (
    OptionComponents,
    save_components_json,
    load_components_json,
)


class TestConfigHash:
    def test_config_hash_stable(self):
        params1 = {"floor": 0.3, "margin": 0.22, "weights": [0.4, 0.4, 0.2]}
        params2 = {"margin": 0.22, "floor": 0.3, "weights": [0.4, 0.4, 0.2]}
        assert _config_hash(params1) == _config_hash(params2)

    def test_config_hash_different(self):
        params1 = {"floor": 0.3, "margin": 0.22}
        params2 = {"floor": 0.35, "margin": 0.22}
        assert _config_hash(params1) != _config_hash(params2)


class TestParamsDiff:
    def test_params_diff_no_changes(self):
        old = {"floor": 0.3, "margin": 0.22}
        new = {"floor": 0.3, "margin": 0.22}
        diff = params_diff(old, new)
        assert diff["added"] == {}
        assert diff["removed"] == {}
        assert diff["changed"] == {}
        assert diff["unchanged"] == {"floor": 0.3, "margin": 0.22}

    def test_params_diff_added(self):
        old = {"floor": 0.3}
        new = {"floor": 0.3, "margin": 0.22}
        diff = params_diff(old, new)
        assert diff["added"] == {"margin": 0.22}
        assert diff["removed"] == {}
        assert diff["changed"] == {}
        assert diff["unchanged"] == {"floor": 0.3}

    def test_params_diff_removed(self):
        old = {"floor": 0.3, "margin": 0.22}
        new = {"floor": 0.3}
        diff = params_diff(old, new)
        assert diff["added"] == {}
        assert diff["removed"] == {"margin": 0.22}
        assert diff["changed"] == {}
        assert diff["unchanged"] == {"floor": 0.3}

    def test_params_diff_changed(self):
        old = {"floor": 0.3, "margin": 0.22}
        new = {"floor": 0.35, "margin": 0.22}
        diff = params_diff(old, new)
        assert diff["added"] == {}
        assert diff["removed"] == {}
        assert diff["changed"] == {"floor": {"old": 0.3, "new": 0.35}}
        assert diff["unchanged"] == {"margin": 0.22}

    def test_params_diff_mixed(self):
        old = {"floor": 0.3, "margin": 0.22, "weights": [0.4, 0.4, 0.2]}
        new = {"floor": 0.35, "low_conf_threshold": 0.4}
        diff = params_diff(old, new)
        assert diff["added"] == {"low_conf_threshold": 0.4}
        assert diff["removed"] == {"margin": 0.22, "weights": [0.4, 0.4, 0.2]}
        assert diff["changed"] == {"floor": {"old": 0.3, "new": 0.35}}
        assert diff["unchanged"] == {}


class TestActiveConfigPersistence:
    def test_write_and_read_active_config(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            import omr.params as params_module
            original_active = params_module._ACTIVE_PATH
            original_history = params_module._HISTORY_DIR
            params_module._ACTIVE_PATH = Path(tmpdir) / "active_config.json"
            params_module._HISTORY_DIR = Path(tmpdir) / "active_config_history"

            try:
                clear_active_config()
                params = {"floor": 0.3, "margin": 0.22, "weights": [0.4, 0.4, 0.2]}
                write_active_config(params)

                meta = get_active_config_with_meta()
                assert "params" in meta
                assert meta["params"] == params
                assert "hash" in meta
                assert len(meta["hash"]) == 16
                assert "updated_at" in meta
                assert meta["updated_at"].endswith("Z")
            finally:
                params_module._ACTIVE_PATH = original_active
                params_module._HISTORY_DIR = original_history

    def test_clear_active_config(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            import omr.params as params_module
            original_active = params_module._ACTIVE_PATH
            params_module._ACTIVE_PATH = Path(tmpdir) / "active_config.json"

            try:
                write_active_config({"floor": 0.3})
                clear_active_config()
                meta = get_active_config_with_meta()
                assert meta == {}
            finally:
                params_module._ACTIVE_PATH = original_active

    def test_history_saved_on_write(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            import omr.params as params_module
            original_active = params_module._ACTIVE_PATH
            original_history = params_module._HISTORY_DIR
            params_module._ACTIVE_PATH = Path(tmpdir) / "active_config.json"
            params_module._HISTORY_DIR = Path(tmpdir) / "active_config_history"

            try:
                clear_active_config()
                write_active_config({"floor": 0.3, "margin": 0.22})
                write_active_config({"floor": 0.35, "margin": 0.25})

                history = list_active_config_history(limit=10)
                assert len(history) == 2
                assert history[0]["params"]["floor"] == 0.35  # mais recente primeiro
                assert history[1]["params"]["floor"] == 0.3
            finally:
                params_module._ACTIVE_PATH = original_active
                params_module._HISTORY_DIR = original_history

    def test_history_limit(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            import omr.params as params_module
            original_active = params_module._ACTIVE_PATH
            original_history = params_module._HISTORY_DIR
            params_module._ACTIVE_PATH = Path(tmpdir) / "active_config.json"
            params_module._HISTORY_DIR = Path(tmpdir) / "active_config_history"

            try:
                clear_active_config()
                for i in range(10):
                    write_active_config({"floor": 0.3 + i * 0.01})

                history = list_active_config_history(limit=5)
                assert len(history) == 5
            finally:
                params_module._ACTIVE_PATH = original_active
                params_module._HISTORY_DIR = original_history


class TestComponentsJsonPersistence:
    def test_save_and_load_components_json(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lab_root = Path(tmpdir)
            session_id = 42

            comps = [
                OptionComponents("A", 0.5, 0.6, 0.7, 128.0),
                OptionComponents("B", 0.4, 0.5, 0.6, 127.0),
                OptionComponents("C", 0.3, 0.4, 0.5, 126.0),
                OptionComponents("D", 0.2, 0.3, 0.4, 125.0),
            ]

            questions_with_comps = [
                {"question_number": 1, "truth": "A", "image_id": 100, "options": comps},
                {"question_number": 2, "truth": "B", "image_id": 100, "options": comps},
            ]

            out_path = save_components_json(session_id, questions_with_comps, lab_root)
            assert out_path.exists()

            loaded = load_components_json(session_id, lab_root)
            assert len(loaded) == 2
            assert loaded[0]["question_number"] == 1
            assert loaded[0]["truth"] == "A"
            assert loaded[0]["image_id"] == 100
            assert len(loaded[0]["options"]) == 4
            assert loaded[0]["options"][0].letter == "A"
            assert loaded[0]["options"][0].mean_intensity == 0.5

    def test_load_components_json_missing_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lab_root = Path(tmpdir)
            loaded = load_components_json(999, lab_root)
            assert loaded == []

    def test_save_components_json_creates_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            lab_root = Path(tmpdir)
            session_id = 123

            questions_with_comps = [
                {"question_number": 1, "options": [
                    OptionComponents("A", 0.5, 0.6, 0.7, 128.0),
                ]},
            ]

            out_path = save_components_json(session_id, questions_with_comps, lab_root)
            assert out_path.parent.exists()
            assert (lab_root / str(session_id)).is_dir()


class TestOmrParamsDataclass:
    def test_is_empty_true(self):
        params = OmrParams()
        assert params.is_empty() is True

    def test_is_empty_false(self):
        params = OmrParams(floor=0.3)
        assert params.is_empty() is False

    def test_is_empty_false_with_weights(self):
        params = OmrParams(weights=(0.4, 0.4, 0.2))
        assert params.is_empty() is False

    def test_params_equality(self):
        p1 = OmrParams(floor=0.3, margin=0.22)
        p2 = OmrParams(floor=0.3, margin=0.22)
        p3 = OmrParams(floor=0.35, margin=0.22)
        assert p1 == p2
        assert p1 != p3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])