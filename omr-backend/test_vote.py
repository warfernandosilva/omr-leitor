"""
Votação multi-frame: N=1 paridade, unânime, divergência, majoridades.
"""
import sys
sys.path.insert(0, '.')

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from omr.reader import OMRResult
from omr.vote import vote_frames

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"   {'OK ' if cond else 'FALHA'}  {name} {extra}")


def res(patch=None) -> OMRResult:
    base = dict(
        answers={}, blank_questions=[], duplicate_questions=[],
        low_confidence=[], all_ratios={}, rectified=None, qr_id=None,
    )
    base.update(patch or {})
    return OMRResult(**base)


# N=1: paridade exata (retorna o próprio frame)
r1 = res({"answers": {1: "A", 2: "B"}, "blank_questions": [3], "low_confidence": [4]})
out1 = vote_frames([r1])
check("N=1: retorna o próprio frame", out1 is r1)

# 3 frames unânimes: ok sem low
frames = [
    res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
    res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
    res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
]
out = vote_frames(frames)
check("unânime: 44 ok, 0 low", len(out.answers) == 44 and not out.low_confidence,
      f"low={out.low_confidence[:5]}")

# divergência em 2 questões: resposta mantida + low_conf
div = res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}})
div.answers[7] = "C"  # frames 1,3 dizem D (7%4=3); frame 2 diz C
out2 = vote_frames([frames[0], div, frames[2]])
check("divergência: resposta da maioria", out2.answers.get(7) == "D", str(out2.answers.get(7)))
check("divergência: low_conf sinalizada", 7 in out2.low_confidence, str(out2.low_confidence))
check("resto unânime: sem low", len(out2.low_confidence) == 1, str(out2.low_confidence))

# ok + 2 blank: resposta mantida + low_conf (frame ok vence blur)
out3 = vote_frames([res({"answers": {1: "A"}}), res({"blank_questions": [1]}), res({"blank_questions": [1]})])
check("ok+blank: resposta mantida", out3.answers.get(1) == "A")
check("ok+blank: low_conf", 1 in out3.low_confidence)

# maioria duplicate
out4 = vote_frames([
    res({"duplicate_questions": [5], "duplicate_marks": {5: ["A", "B"]}}),
    res({"duplicate_questions": [5], "duplicate_marks": {5: ["A", "B"]}}),
    res({"blank_questions": [5]}),
])
check("maioria dup: duplicada", 5 in out4.duplicate_questions, str(out4.duplicate_questions))
check("marcas unidas", out4.duplicate_marks.get(5) == ["A", "B"])

# maioria low (sem ok): resposta + low
out5 = vote_frames([
    res({"low_confidence": [9], "answers": {9: "C"}}),
    res({"low_confidence": [9], "answers": {9: "C"}}),
    res({"blank_questions": [9]}),
])
check("maioria low: resposta mantida", out5.answers.get(9) == "C" and 9 in out5.low_confidence)

# QR: primeiro não-None vence
out6 = vote_frames([res({"qr_id": None}), res({"qr_id": "OMR-2026-1"}), res({"qr_id": "OMR-2026-1"})])
check("QR do primeiro frame legível", out6.qr_id == "OMR-2026-1")

# nenhum frame: None
check("nenhum frame: None", vote_frames([]) is None)
check("todos None: None", vote_frames([None, None]) is None)

# tempos somados
out7 = vote_frames([
    res({"t_detect": 0.1, "t_warp": 0.02, "t_qr": 0.03, "t_score": 0.05}),
    res({"t_detect": 0.1, "t_warp": 0.02, "t_qr": 0.03, "t_score": 0.05}),
    res({"t_detect": 0.1, "t_warp": 0.02, "t_qr": 0.03, "t_score": 0.05}),
])
check("tempos somados", abs(out7.t_detect - 0.3) < 1e-9 and abs(out7.t_score - 0.15) < 1e-9)

print(f"\nVOTE: {len(PASS)} OK | {len(FAIL)} FALHA")
if FAIL:
    print("FALHAS:", FAIL)
    sys.exit(1)
print("VOTE PASS")
