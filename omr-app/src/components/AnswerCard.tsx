// ─── Cartão-resposta renderizado em DOM (mm exatos) ───
// Usado por GenerateCardPage (cartão em branco) e RosterCardsPage
// (cartão personalizado com nome, ID e QR Code do aluno).

import { Exam } from '../types';
import {
  ARUCO_CENTERS, ARUCO_IDS, ARUCO_MARKER_SIZE,
  ALUNO_BOX, TURMA_BOX,
  DIVIDER_X, DIVIDER_Y0, DIVIDER_Y1,
  SUBJECT_TITLES, HEADER_Y, QUESTION_NUM_X,
  PORTUGUESE_X, MATHEMATICS_X,
  questionYFor,
  SINGLE_TITLE_CENTER_X, SINGLE_NUM_X, SINGLE_X,
  singleQuestionYFor, SINGLE_BUBBLE_RADIUS,
  getArUcoGrid,
  STUDENT_QR_SIZE, STUDENT_QR_CENTER,
} from '../utils/card-template';

const SX = 210 / 1448;
const SY = 297 / 2048;
const mmX = (px: number) => `${(px * SX).toFixed(3)}mm`;
const mmY = (px: number) => `${(px * SY).toFixed(3)}mm`;
const mmLen = (px: number) => `${(px * SX).toFixed(3)}mm`;
const mmLenY = (px: number) => `${(px * SY).toFixed(3)}mm`;
const fontPt = (px: number) => `${(px * 0.4112).toFixed(2)}pt`;

export const VALID_ANSWERS = ['A', 'B', 'C', 'D'] as const;

function ArUcoMarker({ id, x, y }: { id: number; x: number; y: number }) {
  const grid = getArUcoGrid(id);
  const cellMm = (ARUCO_MARKER_SIZE / 7) * SX;
  return (
    <div
      className="aruco-marker"
      style={{
        left: mmX(x - ARUCO_MARKER_SIZE / 2),
        top: mmY(y - ARUCO_MARKER_SIZE / 2),
        width: mmLen(ARUCO_MARKER_SIZE),
        height: mmLenY(ARUCO_MARKER_SIZE),
        gridTemplateColumns: `repeat(7, ${mmLen(cellMm)})`,
        gridTemplateRows: `repeat(7, ${mmLenY(cellMm)})`,
      }}
    >
      {grid.flatMap((row, r) =>
        row.map((white, c) => (
          <div
            key={`${r}-${c}`}
            className="aruco-cell"
            style={{ backgroundColor: white ? '#fff' : '#000' }}
          />
        ))
      )}
    </div>
  );
}

interface AnswerCardProps {
  exam: Exam;
  cardId: string;
  studentName?: string;
  qrDataUrl?: string;
  questionsPerSubject?: number;
  layoutMode?: 'dual' | 'single';
}

export default function AnswerCard({
  exam, cardId, studentName, qrDataUrl, questionsPerSubject, layoutMode,
}: AnswerCardProps) {
  const halfQr = STUDENT_QR_SIZE / 2;
  const single = (layoutMode ?? exam.layoutMode ?? 'dual') === 'single';
  const qps = questionsPerSubject ?? exam.questionsPerSubject ?? 22;

  // Modo único: bolhas menores (raio 15 → diâmetro 30px)
  const bubbleMm = single ? `${(SINGLE_BUBBLE_RADIUS * 2 * (210 / 1448)).toFixed(3)}mm` : undefined;
  const questionY = single ? singleQuestionYFor(qps) : questionYFor(qps);
  const xs = single ? SINGLE_X : PORTUGUESE_X;
  const numX = single ? SINGLE_NUM_X : QUESTION_NUM_X.portugues;

  return (
    <>
      {/* QR Code do aluno (topo central) */}
      {qrDataUrl && (
        <img
          src={qrDataUrl}
          alt=""
          className="student-qr"
          style={{
            left: mmX(STUDENT_QR_CENTER.x - halfQr),
            top: mmY(STUDENT_QR_CENTER.y - halfQr),
            width: mmLen(STUDENT_QR_SIZE),
            height: mmLenY(STUDENT_QR_SIZE),
          }}
        />
      )}

      {/* Aluno */}
      <div
        className="id-box"
        style={{
          left: mmX(ALUNO_BOX.x0), top: mmY(ALUNO_BOX.y0),
          width: mmLen(ALUNO_BOX.x1 - ALUNO_BOX.x0),
          height: mmLenY(ALUNO_BOX.y1 - ALUNO_BOX.y0),
        }}
      >
        <span className="id-label" style={{ fontSize: fontPt(38) }}>{ALUNO_BOX.label}</span>
        {studentName && (
          <span className="id-value" style={{ fontSize: fontPt(36) }}>{studentName}</span>
        )}
      </div>
      {/* Turma */}
      <div
        className="id-box"
        style={{
          left: mmX(TURMA_BOX.x0), top: mmY(TURMA_BOX.y0),
          width: mmLen(TURMA_BOX.x1 - TURMA_BOX.x0),
          height: mmLenY(TURMA_BOX.y1 - TURMA_BOX.y0),
        }}
      >
        <span className="id-label" style={{ fontSize: fontPt(38) }}>{TURMA_BOX.label}</span>
      </div>

      {/* ArUco markers */}
      <ArUcoMarker id={ARUCO_IDS.TL} x={ARUCO_CENTERS.TL.x} y={ARUCO_CENTERS.TL.y} />
      <ArUcoMarker id={ARUCO_IDS.TR} x={ARUCO_CENTERS.TR.x} y={ARUCO_CENTERS.TR.y} />
      <ArUcoMarker id={ARUCO_IDS.BR} x={ARUCO_CENTERS.BR.x} y={ARUCO_CENTERS.BR.y} />
      <ArUcoMarker id={ARUCO_IDS.BL} x={ARUCO_CENTERS.BL.x} y={ARUCO_CENTERS.BL.y} />

      {/* Divider (apenas modo duplo) */}
      {!single && (
        <div
          className="divider"
          style={{
            left: mmX(DIVIDER_X), top: mmY(DIVIDER_Y0),
            width: mmLen(5), height: mmLenY(DIVIDER_Y1 - DIVIDER_Y0),
          }}
        />
      )}

      {/* Subject titles */}
      {single ? (
        <div
          className="subject-title"
          style={{ left: mmX(SINGLE_TITLE_CENTER_X), top: mmY(SUBJECT_TITLES.portugues.centerY), fontSize: fontPt(36) }}
        >
          {exam.subjectLP}
        </div>
      ) : (
        <>
          <div
            className="subject-title"
            style={{ left: mmX(SUBJECT_TITLES.portugues.centerX), top: mmY(SUBJECT_TITLES.portugues.centerY), fontSize: fontPt(36) }}
          >
            {exam.subjectLP}
          </div>
          <div
            className="subject-title"
            style={{ left: mmX(SUBJECT_TITLES.matematica.centerX), top: mmY(SUBJECT_TITLES.matematica.centerY), fontSize: fontPt(36) }}
          >
            {exam.subjectMat}
          </div>
        </>
      )}

      {/* Column headers */}
      {(single ? SINGLE_X : PORTUGUESE_X).map((x, c) => (
        <span key={`h-p-${c}`} className="opt-header" style={{ left: mmX(x), top: mmY(HEADER_Y), fontSize: fontPt(40) }}>
          {VALID_ANSWERS[c]}
        </span>
      ))}
      {!single && MATHEMATICS_X.map((x, c) => (
        <span key={`h-m-${c}`} className="opt-header" style={{ left: mmX(x), top: mmY(HEADER_Y), fontSize: fontPt(40) }}>
          {VALID_ANSWERS[c]}
        </span>
      ))}

      {/* Question rows */}
      {questionY.map((y, q) => (
        <div key={`row-${q}`} className="answer-row" style={{ top: mmY(y) }}>
          <span className="q-num" style={{ left: `${(numX * SX).toFixed(3)}mm`, fontSize: fontPt(single ? 24 : 28) }}>
            {q + 1}
          </span>
          {xs.map((x, c) => (
            <span
              key={`b-p-${q}-${c}`}
              className="bubble"
              style={{
                left: mmX(x),
                ...(single ? { width: bubbleMm, height: bubbleMm } : {}),
              }}
            />
          ))}
          {!single && (
            <>
              <span className="q-num" style={{ left: `${(QUESTION_NUM_X.matematica * SX).toFixed(3)}mm`, fontSize: fontPt(28) }}>
                {q + 1}
              </span>
              {MATHEMATICS_X.map((x, c) => (
                <span key={`b-m-${q}-${c}`} className="bubble" style={{ left: mmX(x) }} />
              ))}
            </>
          )}
        </div>
      ))}

      <div className="card-id">ID: {cardId}</div>
    </>
  );
}
