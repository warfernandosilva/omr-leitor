import sys
sys.path.insert(0, '.')
import io, json
from fastapi.testclient import TestClient
import main as M

c = TestClient(M.app)
r = c.post('/api/auth/login', data={'username': 'test@herby.com', 'password': '123456'})
assert r.status_code == 200, r.text
tok = r.json()['access_token']
c.headers.update({'Authorization': f'Bearer {tok}'})

r = c.post('/api/exams/sync', json={'external_id': 'herby-test-1', 'titulo': 'Herby Teste', 'turma': '5A', 'template': 'herby', 'questions_per_subject': 22})
print('sync:', r.status_code, r.json())
av_id = r.json()['avaliacao_id']

r = c.post('/api/exams/herby-test-1/students/import', json={'alunos': [{'nome': 'ALUNO TESTE'}]})
print('import:', r.status_code, r.json())
gen = c.post('/api/exams/herby-test-1/gabaritos/generate')
print('generate:', gen.status_code, gen.json())

import io
r = c.post('/api/card/generate', json={'template': 'herby', 'subject_lp': 'PORTUGUES', 'subject_mat': 'MATEMATICA', 'questions_per_subject': 22, 'format': 'PNG'})
print('card generate:', r.status_code, r.headers.get('content-disposition'))
if r.status_code == 200:
    with open('test_herby_card.png', 'wb') as f:
        f.write(r.content)
    print('Saved test_herby_card.png')

print('DONE')