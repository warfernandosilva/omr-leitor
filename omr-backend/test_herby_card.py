"""Herby via API: sync + import + generate + /api/card/generate (PNG válido).

Isolado por módulo (conftest): registra o usuário (ou loga), nunca toca o
banco real; o PNG vai para tmp_path, nunca para o repo.

Executar: python -m pytest test_herby_card.py -q
"""
from conftest import TEST_PASSWORD


def test_herby_card_api(client, tmp_path):
    c = client
    r = c.post('/api/auth/register', json={'email': 'test@herby.com', 'nome': 'Herby', 'password': TEST_PASSWORD})
    if r.status_code == 400:
        r = c.post('/api/auth/login', data={'username': 'test@herby.com', 'password': TEST_PASSWORD})
    assert r.status_code == 200, r.text
    c.headers.update({'Authorization': f"Bearer {r.json()['access_token']}"})

    r = c.post('/api/exams/sync', json={'external_id': 'herby-test-1', 'titulo': 'Herby Teste',
                                        'turma': '5A', 'template': 'herby', 'questions_per_subject': 22})
    assert r.status_code == 200, f"sync herby → 200: {r.text}"
    assert r.json()['avaliacao_id'] > 0

    r = c.post('/api/exams/herby-test-1/students/import', json={'alunos': [{'nome': 'ALUNO TESTE'}]})
    assert r.status_code == 200, f"import → 200: {r.text}"
    gen = c.post('/api/exams/herby-test-1/gabaritos/generate')
    assert gen.status_code == 200, f"generate → 200: {gen.text}"
    assert gen.json()["total_gabaritos"] == 1

    r = c.post('/api/card/generate', json={'template': 'herby', 'subject_lp': 'PORTUGUES',
                                           'subject_mat': 'MATEMATICA', 'questions_per_subject': 22,
                                           'format': 'PNG'})
    assert r.status_code == 200, f"card generate → 200: {r.text[:200]}"
    assert r.content[:8] == b"\x89PNG\r\n\x1a\n", "resposta é um PNG válido"
    out = tmp_path / "test_herby_card.png"
    out.write_bytes(r.content)


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
