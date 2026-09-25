"""Auto-importado pelo Python no startup (está na mesma pasta dos scripts).

Console Windows (cp1252): força stdout/stderr em UTF-8 para os scripts de
teste não quebrarem em nomes com acento em qualquer máquina BR.
Inócuo no Linux/macOS e no app (main.py).
"""
import sys

for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name, None)
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
