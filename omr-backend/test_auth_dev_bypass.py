"""Autenticação: o bypass anônimo de desenvolvimento é opt-in e nunca vale em
produção. Sem a variável, o comportamento é o 401 de sempre.

Corrige a origem de 10 falhas locais em que um stub devolvia admin anônimo
incondicionalmente (todo mundo passava nas checagens de token/isolamento).
"""
from __future__ import annotations

import auth


def test_dev_bypass_disabled_by_default(client, monkeypatch):
    monkeypatch.delenv("OMR_DEV_ANONYMOUS", raising=False)
    monkeypatch.delenv("OMR_ENV", raising=False)
    assert auth.dev_anonymous_enabled() is False
    assert client.get("/api/auth/me").status_code in (401, 403)


def test_dev_bypass_enabled_grants_admin(client, monkeypatch):
    monkeypatch.delenv("OMR_ENV", raising=False)
    monkeypatch.setenv("OMR_DEV_ANONYMOUS", "1")
    assert auth.dev_anonymous_enabled() is True
    r = client.get("/api/auth/me")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["role"] == "admin"
    assert body["id"] == 1


def test_dev_bypass_refused_in_production(client, monkeypatch):
    monkeypatch.setenv("OMR_DEV_ANONYMOUS", "1")
    monkeypatch.setenv("OMR_ENV", "production")
    assert auth.dev_anonymous_enabled() is False
    assert client.get("/api/auth/me").status_code in (401, 403)


def test_dev_bypass_env_values(monkeypatch):
    monkeypatch.delenv("OMR_ENV", raising=False)
    for v in ("1", "true", "YES", "on"):
        monkeypatch.setenv("OMR_DEV_ANONYMOUS", v)
        assert auth.dev_anonymous_enabled() is True, v
    for v in ("0", "false", "no", ""):
        monkeypatch.setenv("OMR_DEV_ANONYMOUS", v)
        assert auth.dev_anonymous_enabled() is False, v
