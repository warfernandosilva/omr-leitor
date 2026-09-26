"""
Votação multi-frame: N=1 paridade, unânime, divergência, majoridades.

Executar: python -m pytest test_vote.py -q
"""
from omr.reader import OMRResult
from omr.vote import vote_frames


def res(patch=None) -> OMRResult:
    base = dict(
        answers={}, blank_questions=[], duplicate_questions=[],
        low_confidence=[], all_ratios={}, rectified=None, qr_id=None,
    )
    base.update(patch or {})
    return OMRResult(**base)


def test_single_frame_passthrough():
    # N=1: paridade exata (retorna o próprio frame)
    r1 = res({"answers": {1: "A", 2: "B"}, "blank_questions": [3], "low_confidence": [4]})
    out1 = vote_frames([r1])
    assert out1 is r1, "N=1: retorna o próprio frame"


def test_unanimous():
    # 3 frames unânimes: ok sem low
    frames = [
        res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
        res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
        res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
    ]
    out = vote_frames(frames)
    assert len(out.answers) == 44 and not out.low_confidence, \
        f"unânime: 44 ok, 0 low: low={out.low_confidence[:5]}"


def test_divergence_goes_to_low_conf():
    frames = [
        res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
        res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
        res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}}),
    ]
    div = res({"answers": {q: "ABCD"[q % 4] for q in range(1, 45)}})
    div.answers[7] = "C"  # frames 1,3 dizem D (7%4=3); frame 2 diz C
    out2 = vote_frames([frames[0], div, frames[2]])
    assert out2.answers.get(7) == "D", f"divergência: resposta da maioria: {out2.answers.get(7)}"
    assert 7 in out2.low_confidence, f"divergência: low_conf sinalizada: {out2.low_confidence}"
    assert len(out2.low_confidence) == 1, f"resto unânime: sem low: {out2.low_confidence}"


def test_ok_beats_blank():
    # ok + 2 blank: resposta mantida + low_conf (frame ok vence blur)
    out3 = vote_frames([res({"answers": {1: "A"}}), res({"blank_questions": [1]}), res({"blank_questions": [1]})])
    assert out3.answers.get(1) == "A", "ok+blank: resposta mantida"
    assert 1 in out3.low_confidence, "ok+blank: low_conf"


def test_duplicate_majority():
    # maioria duplicate
    out4 = vote_frames([
        res({"duplicate_questions": [5], "duplicate_marks": {5: ["A", "B"]}}),
        res({"duplicate_questions": [5], "duplicate_marks": {5: ["A", "B"]}}),
        res({"blank_questions": [5]}),
    ])
    assert 5 in out4.duplicate_questions, f"maioria dup: duplicada: {out4.duplicate_questions}"
    assert out4.duplicate_marks.get(5) == ["A", "B"], "marcas unidas"


def test_low_conf_majority():
    # maioria low (sem ok): resposta + low
    out5 = vote_frames([
        res({"low_confidence": [9], "answers": {9: "C"}}),
        res({"low_confidence": [9], "answers": {9: "C"}}),
        res({"blank_questions": [9]}),
    ])
    assert out5.answers.get(9) == "C" and 9 in out5.low_confidence, "maioria low: resposta mantida"


def test_qr_first_readable_wins():
    # QR: primeiro não-None vence
    out6 = vote_frames([res({"qr_id": None}), res({"qr_id": "OMR-2026-1"}), res({"qr_id": "OMR-2026-1"})])
    assert out6.qr_id == "OMR-2026-1", "QR do primeiro frame legível"


def test_empty_and_none_frames():
    # nenhum frame: None
    assert vote_frames([]) is None, "nenhum frame: None"
    assert vote_frames([None, None]) is None, "todos None: None"


def test_timings_summed():
    # tempos somados
    out7 = vote_frames([
        res({"t_detect": 0.1, "t_warp": 0.02, "t_qr": 0.03, "t_score": 0.05}),
        res({"t_detect": 0.1, "t_warp": 0.02, "t_qr": 0.03, "t_score": 0.05}),
        res({"t_detect": 0.1, "t_warp": 0.02, "t_qr": 0.03, "t_score": 0.05}),
    ])
    assert abs(out7.t_detect - 0.3) < 1e-9 and abs(out7.t_score - 0.15) < 1e-9, "tempos somados"


if __name__ == "__main__":
    import pytest as _pytest
    import sys as _sys
    _sys.exit(_pytest.main([__file__, "-q"]))
