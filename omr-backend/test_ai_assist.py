"""Assistente de correção local (Ollama): contrato do endpoint e parsing."""
from fastapi.testclient import TestClient

import ai_assist
import main as main_module

PNG = "data:image/png;base64,iVBORw0KGgo="


def test_status_requires_auth():
    res = TestClient(main_module.app).get("/api/ai/status")
    assert res.status_code == 401


def test_status_devolve_modelo(authed, monkeypatch):
    monkeypatch.setattr(ai_assist, "status", lambda: {
        "available": True, "url": "http://localhost:11434",
        "model": "moondream", "models": ["moondream:latest"], "error": None,
    })
    res = authed.get("/api/ai/status")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["model"] == "moondream"


def _fake_tags(monkeypatch, names: list[str]):
    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"models": [{"name": n} for n in names]}

    class FakeClient:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, url):
            return FakeResponse()

    monkeypatch.setattr(ai_assist.httpx, "Client", FakeClient)


def test_status_avisa_modelo_de_leitura_faltando(monkeypatch):
    _fake_tags(monkeypatch, ["qwen2.5vl:7b"])
    monkeypatch.setattr(ai_assist, "OLLAMA_MODEL", "qwen2.5vl:7b")
    monkeypatch.setattr(ai_assist, "OLLAMA_READ_MODEL", "moondream")

    body = ai_assist.status()
    assert body["available"] is True
    assert body["error"] is None
    assert body["read_model"] == "moondream"
    assert body["read_available"] is False
    assert "ollama pull moondream" in body["read_error"]


def test_status_com_os_dois_modelos(monkeypatch):
    _fake_tags(monkeypatch, ["moondream:latest", "qwen2.5vl:7b"])
    monkeypatch.setattr(ai_assist, "OLLAMA_MODEL", "moondream")
    monkeypatch.setattr(ai_assist, "OLLAMA_READ_MODEL", "qwen2.5vl:7b")

    body = ai_assist.status()
    assert body["available"] is True and body["read_available"] is True
    assert body["error"] is None and body["read_error"] is None


def test_assist_sugere_letra_do_modelo(authed, monkeypatch):
    monkeypatch.setattr(ai_assist, "_call_ollama", lambda image, prompt: "B")
    res = authed.post("/api/ai/assist", json={
        "image": PNG,
        "question": 7,
        "options": ["A", "B", "C", "D"],
        "ratios": {"A": 0.10, "B": 0.62, "C": 0.08, "D": 0.05},
        "context": {"low_confidence": True},
    })
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["suggestion"] == "B"
    assert body["source"] == "model"
    assert 0.5 <= body["confidence"] <= 0.99
    assert "Scores do OMR" in body["reason"]


def test_assist_cai_nos_ratios_quando_modelo_nao_responde(authed, monkeypatch):
    monkeypatch.setattr(ai_assist, "_call_ollama", lambda image, prompt: "não sei")
    res = authed.post("/api/ai/assist", json={
        "image": PNG,
        "question": 3,
        "ratios": {"A": 0.05, "B": 0.12, "C": 0.71, "D": 0.02},
    })
    body = res.json()
    assert body["ok"] is True
    assert body["suggestion"] == "C"
    assert body["source"] == "ratios"


def test_assist_reconhece_vazio(authed, monkeypatch):
    monkeypatch.setattr(ai_assist, "_call_ollama", lambda image, prompt: "VAZIO")
    res = authed.post("/api/ai/assist", json={"image": PNG, "question": 1})
    body = res.json()
    assert body["ok"] is True
    assert body["suggestion"] == "VAZIO"


def test_assist_recusa_imagem_invalida(authed):
    res = authed.post("/api/ai/assist", json={"image": "nao-e-imagem", "question": 1})
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is False
    assert "Imagem inválida" in body["error"]


def test_parse_choice():
    assert ai_assist._parse_choice("A", ["A", "B", "C", "D"]) == "A"
    assert ai_assist._parse_choice("resposta: c", ["A", "B", "C", "D"]) == "C"
    assert ai_assist._parse_choice("VAZIO", ["A", "B", "C", "D"]) == "VAZIO"
    assert ai_assist._parse_choice("em branco", ["A", "B", "C", "D"]) == "VAZIO"
    assert ai_assist._parse_choice("E", ["A", "B", "C", "D"]) is None
    assert ai_assist._parse_choice("", ["A", "B", "C", "D"]) is None


# ---------------------------------------------------------------------------
# Leitura da folha inteira (/api/ai/read)
# ---------------------------------------------------------------------------

def test_read_sheet_devolve_respostas(authed, monkeypatch):
    calls = {}

    def fake(image, prompt, **kw):
        calls.update(kw, prompt=prompt)
        return '```json\n{"1": "A", "2": "C", "3": "VAZIO"}\n```'

    monkeypatch.setattr(ai_assist, "_call_ollama", fake)
    res = authed.post("/api/ai/read", json={
        "image": PNG, "questions": [1, 2, 3], "options": ["A", "B", "C", "D"],
    })
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["answers"] == {"1": "A", "2": "C", "3": "VAZIO"}
    assert body["missing"] == []
    # JSON estrito + folga de tokens proporcional ao nº de questões
    assert calls["json_mode"] is True
    assert calls["num_predict"] > 16
    assert "1, 2, 3" in calls["prompt"]
    assert body["model"] == ai_assist.OLLAMA_READ_MODEL


def test_read_sheet_descarta_invalida_e_marca_faltante(authed, monkeypatch):
    monkeypatch.setattr(
        ai_assist, "_call_ollama",
        lambda image, prompt, **kw: '{"1": "E", "2": "b", "9": "A"}',
    )
    body = authed.post("/api/ai/read", json={
        "image": PNG, "questions": [1, 2, 3],
    }).json()
    # "E" não é opção e a Q9 não existe nesta folha
    assert body["answers"] == {"2": "B"}
    assert body["missing"] == [1, 3]


def test_read_sheet_aceita_answers_aninhado_e_lista(authed, monkeypatch):
    monkeypatch.setattr(
        ai_assist, "_call_ollama",
        lambda image, prompt, **kw: '{"answers": ["A", "D"]}',
    )
    body = authed.post("/api/ai/read", json={
        "image": PNG, "questions": [4, 5],
    }).json()
    assert body["answers"] == {"4": "A", "5": "D"}


def test_read_sheet_recusa_imagem_invalida_e_lista_vazia(authed):
    body = authed.post("/api/ai/read", json={
        "image": "nao-e-imagem", "questions": [1],
    }).json()
    assert body["ok"] is False and "Imagem inválida" in body["error"]

    body = authed.post("/api/ai/read", json={
        "image": PNG, "questions": [],
    }).json()
    assert body["ok"] is False and "Nenhuma questão" in body["error"]


def test_parse_answers_tolera_lixo():
    assert ai_assist._parse_answers("não sei", [1, 2], ["A", "B"]) == {}
    assert ai_assist._parse_answers('{"x": "A"}', [1], ["A", "B"]) == {}
    assert ai_assist._parse_answers('{"1": "A"}', [1], ["A", "B"]) == {"1": "A"}
