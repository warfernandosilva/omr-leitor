# Calibração com fotos reais

Solte aqui as fotos problemáticas **originais** do aparelho (JPG direto da
câmera/galeria, sem recompressão de WhatsApp) e rode:

```bat
python calib_foto.py <arquivo.jpg> [--qps 22] [--modo dual]
```

O script imprime `all_ratios` das questões suspeitas para calibrar
`FLOOR`/`MARGIN` em `omr/config.py` com dados reais.
