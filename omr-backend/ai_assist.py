"""Assistente de correção com modelo de visão local (Ollama).

Uma questão por vez: o backend envia só o RECORTE das bolhas daquela questão
(nunca a folha inteira, nem nome/QR) para o Ollama rodando em localhost.

Ler a folha inteira de uma vez NÃO funciona com modelos locais pequenos: a
imagem fica densa demais e o modelo inventa um gabarito em ciclo (A, B, C, D...)
quando não consegue ver a marca. Por isso a conferência é feita questão a
questão, com o recorte justo da linha.

Configuração (variáveis de ambiente):
- OLLAMA_URL     (default http://localhost:11434)
- OLLAMA_MODEL   (default moondream)
- OLLAMA_TIMEOUT segundos (default 60)

O assistente NUNCA altera a resposta sozinho: ele devolve uma sugestão e a UI
decide se aplica.
"""

from __future__ import annotations

import base64
import os
import re

import httpx

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "moondream")
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "60"))
MAX_IMAGE_BYTES = 4 * 1024 * 1024
LETTERS = ("A", "B", "C", "D")

_CHOICE_RE = re.compile(r"\b([ABCD])\b")
_BLANK_RE = re.compile(r"\b(VAZIO|EM\s+BRANCO|NENHUMA)\b", re.IGNORECASE)


class AiAssistError(Exception):
    """Falha amigável para devolver à UI (sem stack trace)."""


def _same_model(installed: str, wanted: str) -> bool:
    if not installed:
        return False
    return installed == wanted or installed.split(":", 1)[0] == wanted.split(":", 1)[0]


def _friendly_http_error(exc: Exception) -> str:
    if isinstance(exc, httpx.ConnectError):
        return (
            "Ollama não encontrado. Instale/abra o Ollama e rode "
            f"'ollama pull {OLLAMA_MODEL}' neste computador."
        )
    if isinstance(exc, httpx.TimeoutException):
        return (
            "O Ollama demorou demais para responder. Modelos locais em CPU podem "
            "levar alguns segundos; tente novamente ou use um modelo menor."
        )
    return f"Falha ao falar com o Ollama: {exc}"


def _missing_model(model: str) -> str:
    return f"Modelo '{model}' não instalado. Rode: ollama pull {model}"


def status() -> dict:
    """Detecta se o Ollama está acessível e se o modelo configurado existe."""
    base = {"url": OLLAMA_URL, "model": OLLAMA_MODEL}
    try:
        with httpx.Client(timeout=3.0) as client:
            res = client.get(f"{OLLAMA_URL}/api/tags")
            res.raise_for_status()
            models = [
                str(m.get("name") or "")
                for m in (res.json().get("models") or [])
                if m.get("name")
            ]
    except Exception as exc:  # noqa: BLE001 - status nunca deve derrubar a API
        return {**base, "available": False, "models": [], "error": _friendly_http_error(exc)}
    model_ok = any(_same_model(m, OLLAMA_MODEL) for m in models)
    return {
        **base,
        "available": model_ok,
        "models": models,
        "error": None if model_ok else _missing_model(OLLAMA_MODEL),
    }


def _decode_data_url(image: str) -> str:
    if not isinstance(image, str) or not image.startswith("data:image"):
        raise AiAssistError("Imagem inválida: envie um recorte em data URL.")
    try:
        header, payload = image.split(",", 1)
    except ValueError as exc:
        raise AiAssistError("Imagem inválida: data URL malformada.") from exc
    if ";base64" not in header:
        raise AiAssistError("Imagem inválida: esperava base64.")
    try:
        raw = base64.b64decode(payload, validate=False)
    except Exception as exc:  # noqa: BLE001
        raise AiAssistError("Imagem inválida: base64 ilegível.") from exc
    if len(raw) > MAX_IMAGE_BYTES:
        raise AiAssistError("Recorte muito grande para o assistente (limite 4MB).")
    return payload


def _build_prompt(question: int, options: list[str], ratios: dict[str, float] | None,
                  context: dict | None) -> str:
    opts = ", ".join(options) or "A, B, C, D"
    lines = [
        "Você é um assistente de correção de cartão-resposta.",
        f"A imagem é um recorte da questão {question}.",
        f"As alternativas aparecem da esquerda para a direita na ordem: {opts}.",
        "Uma bolha marcada pelo aluno aparece preenchida (preta/escura).",
    ]
    if ratios:
        scores = ", ".join(f"{k}={v:.3f}" for k, v in sorted(ratios.items()))
        lines.append(
            "Scores de preenchimento calculados pelo OMR (0=vazio, 1=cheio): "
            f"{scores}. Use como apoio, mas confie na imagem."
        )
    ctx = context or {}
    if ctx.get("duplicate"):
        marks = ctx.get("marks") or []
        lines.append(
            "Atenção: o OMR detectou DUAS marcações nesta questão"
            + (f" ({', '.join(map(str, marks))})" if marks else "")
            + ". Diga qual delas parece mais forte/preenchida."
        )
    if ctx.get("blank"):
        lines.append("O OMR considerou a questão em branco; verifique se há marca fraca.")
    lines.append(
        "Responda SOMENTE com uma letra entre as alternativas "
        f"({opts}) ou VAZIO se nenhuma estiver marcada. Não escreva mais nada."
    )
    return "\n".join(lines)


def _call_ollama(image_b64: str, prompt: str, num_predict: int = 16) -> str:
    """Chamada isolada (monkeypatchável nos testes)."""
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "images": [image_b64],
        "stream": False,
        "options": {"temperature": 0, "num_predict": num_predict},
    }
    try:
        with httpx.Client(timeout=OLLAMA_TIMEOUT) as client:
            res = client.post(f"{OLLAMA_URL}/api/generate", json=payload)
            res.raise_for_status()
            data = res.json()
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise AiAssistError(
                f"Modelo '{OLLAMA_MODEL}' não instalado. Rode: ollama pull {OLLAMA_MODEL}"
            ) from exc
        raise AiAssistError(_friendly_http_error(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise AiAssistError(_friendly_http_error(exc)) from exc
    return str(data.get("response") or "")


def _parse_choice(text: str, options: list[str]) -> str | None:
    cleaned = (text or "").strip().upper()
    if _BLANK_RE.search(cleaned):
        return "VAZIO"
    allowed = set(options or LETTERS)
    for match in _CHOICE_RE.finditer(cleaned):
        letter = match.group(1)
        if letter in allowed:
            return letter
    return None


def _confidence(ratios: dict[str, float] | None, suggestion: str | None) -> float:
    if not ratios or not suggestion or suggestion == "VAZIO":
        return 0.5
    ordered = sorted(
        ((str(k).upper(), float(v)) for k, v in ratios.items() if str(k).upper() in LETTERS),
        key=lambda item: item[1],
        reverse=True,
    )
    if not ordered:
        return 0.5
    top_letter, top = ordered[0]
    second = ordered[1][1] if len(ordered) > 1 else 0.0
    margin = max(0.0, min(1.0, (top - second) / max(top, 1e-6)))
    if suggestion == top_letter:
        return round(min(0.99, 0.55 + 0.44 * margin), 2)
    return 0.35


def _reason(ratios: dict[str, float] | None, suggestion: str | None,
            source: str, context: dict | None) -> str:
    parts: list[str] = []
    if source == "ratios":
        parts.append("O modelo visual não respondeu; usei o maior score do OMR.")
    else:
        parts.append("Sugestão do modelo visual local.")
    if ratios:
        ordered = sorted(ratios.items(), key=lambda item: float(item[1]), reverse=True)
        scores = ", ".join(f"{k}={float(v):.2f}" for k, v in ordered)
        parts.append(f"Scores do OMR: {scores}.")
    ctx = context or {}
    marks = ctx.get("marks") or []
    if ctx.get("duplicate") and marks:
        parts.append(f"Marcas detectadas: {' e '.join(map(str, marks))}.")
    if suggestion == "VAZIO":
        parts.append("Nenhuma bolha parece preenchida.")
    return " ".join(parts)


def assist(
    image: str,
    question: int,
    options: list[str] | None = None,
    ratios: dict[str, float] | None = None,
    context: dict | None = None,
) -> dict:
    """Sugere a alternativa marcada. Levanta AiAssistError em falha amigável."""
    opts = [str(o).upper() for o in (options or list(LETTERS)) if str(o).strip()]
    image_b64 = _decode_data_url(image)
    prompt = _build_prompt(question, opts, ratios, context)

    raw = _call_ollama(image_b64, prompt)
    suggestion = _parse_choice(raw, opts)
    source = "model"
    if suggestion is None and ratios:
        top = max(
            ((str(k).upper(), float(v)) for k, v in ratios.items() if str(k).upper() in opts),
            key=lambda item: item[1],
            default=None,
        )
        if top:
            suggestion, source = top[0], "ratios"

    if suggestion is not None and suggestion != "VAZIO" and suggestion not in opts:
        suggestion = None

    return {
        "ok": True,
        "suggestion": suggestion,
        "confidence": _confidence(ratios, suggestion),
        "reason": _reason(ratios, suggestion, source, context),
        "source": source,
        "model": OLLAMA_MODEL,
        "raw": raw.strip()[:200],
    }
