# Calibração com fotos reais

Solte aqui as fotos problemáticas **originais** do aparelho (JPG direto da
câmera/galeria, sem recompressão de WhatsApp) e rode:

```bat
python calib_foto.py <arquivo.jpg> [--qps 22] [--modo dual] [--adaptive]
```

O script imprime `all_ratios` das questões suspeitas para calibrar
`FLOOR`/`MARGIN` em `omr/config.py` com dados reais. Com `--adaptive`,
compara limiar fixo x adaptativo lado a lado.

## Limiar adaptativo — critério para virar padrão (OFF até lá)

O adaptativo (`omr/adaptive.py`, Otsu sobre os scores da foto, travas
`[0.20, 0.45]` + fallback ao fixo) só vira default quando, em fotos reais
variadas (clara/escura, ≥2 aparelhos), atingir: `ok` ≥ fixo em todas,
nenhum `blank`/`duplicate` espúrio novo. Registrar abaixo cada evidência.

| Data | Foto | Fixo (ok/brancas/dups/low) | Adaptativo (floor/ok/...) | Veredito |
|------|------|----------------------------|---------------------------|----------|
| 2026-09-21 | WhatsApp 18.21.48 (layout ANTIGO do cartão, 10Q — incompatível com o template atual) | 7/9/27d/4l | floor 0.268, 7/8/28d/4l | INCONCLUSIVA — foto de versão anterior do cartão, não serve de evidência |

Evidência sintética (válida): `python test_adaptive.py` — paridade fixo x
adaptativo em cartão degradado, 0 fantasmas, duplicada real detectada,
regressão `test_dup_regression` verde nos dois modos.
