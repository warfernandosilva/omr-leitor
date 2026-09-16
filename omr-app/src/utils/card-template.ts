// ─── Template OMR — Coordenadas exatas da imagem de referência ───
// Canvas: 1448×2048 px (≈A4 vertical)
// 1 px ≈ 0.145 mm
// ArUco: DICT_4X4_50, IDs 0-3

export const CARD_WIDTH = 1448;
export const CARD_HEIGHT = 2048;

// ─── ArUco DICT_4X4_50 markers ───
// 7×7 grid: outer border black, inner 5×5 data from OpenCV.

export const ARUCO_MARKER_SIZE = 104;
export const ARUCO_IDS = { TL: 0, TR: 1, BR: 2, BL: 3 } as const;
export type ArUcoCorner = keyof typeof ARUCO_IDS;

// Marker centers (position of each marker's center on the canvas)
export const ARUCO_CENTERS: Record<ArUcoCorner, { x: number; y: number }> = {
  TL: { x: 138, y: 531 },   // 86 + 104/2, 479 + 104/2
  TR: { x: 1310, y: 531 },  // 1258 + 104/2, 479 + 104/2
  BR: { x: 1310, y: 1876 }, // 1258 + 104/2, 1824 + 104/2
  BL: { x: 138, y: 1876 },  // 86 + 104/2, 1824 + 104/2
};

export const ARUCO_HOMOGRAPHY_ORDER: ArUcoCorner[] = ['TL', 'TR', 'BR', 'BL'];
export const ARUCO_POINTS_ARRAY = ARUCO_HOMOGRAPHY_ORDER.map(c => ARUCO_CENTERS[c]);

// 7×7 bit patterns extracted from OpenCV DICT_4X4_50 (IDs 0-3)
// true = white, false = black
const ARUCO_BITS: Record<number, string> = {
  0: '0000000001011000010100000110000011000001000000000',
  1: '0000000000000000111100010010001001000101000000000',
  2: '0000000000011000001100000100000010000110100000000',
  3: '0000000001001000100100001000000100000011000000000',
};

export type ArUcoGrid = boolean[][];

export function getArUcoGrid(id: number): ArUcoGrid {
  const bits = ARUCO_BITS[id];
  if (!bits) throw new Error(`ArUco ID ${id} não encontrado`);
  const grid: boolean[][] = [];
  for (let r = 0; r < 7; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < 7; c++) {
      row.push(bits[r * 7 + c] === '1');
    }
    grid.push(row);
  }
  return grid;
}

// ─── QR Code (legacy, kept for backward compat) ───
export const QR_SIZE = 160;
export const QR_CENTER = { x: CARD_WIDTH / 2, y: 50 };
export const QR_PAYLOAD = 'OMR|MODEL=GABARITO_01|VERSION=2';
export const QR_MODEL = 'GABARITO_01';
export const QR_VERSION = 2;

// ─── Slot do QR Code do aluno (cartão personalizado) ───
// Deve espelhar QR_CENTER / QR_SIZE de omr-backend/omr/template.py.
export const STUDENT_QR_SIZE = 180;
export const STUDENT_QR_CENTER = { x: 1265, y: 230 };
export const STUDENT_NAME_X = 320;

// ─── Layout ───

export const ALUNO_BOX = { x0: 85, y0: 137, x1: 1363, y1: 221, label: 'Aluno (a):' };
export const TURMA_BOX = { x0: 85, y0: 229, x1: 725, y1: 313, label: 'Turma:' };

export const DIVIDER_X = 723;
export const DIVIDER_Y0 = 584;
export const DIVIDER_Y1 = 1825;

export const SUBJECT_TITLES = {
  portugues: { text: 'PORTUGUÊS', centerX: 483, centerY: 489, fontSize: 36 },
  matematica: { text: 'MATEMÁTICA', centerX: 1034, centerY: 489, fontSize: 36 },
} as const;

export const HEADER_Y = 577;

export const QUESTION_NUM_X = { portugues: 280, matematica: 832 } as const;

// ─── Grid de bolhas ───

export const BUBBLE_RADIUS = 19.5;

export const QUESTIONS_PER_SUBJECT = 22;      // padrão/legado
export const MAX_QUESTIONS_PER_SUBJECT = 26;  // limite físico do layout
const FIRST_QUESTION_Y = 653.0;
const LAST_QUESTION_Y = 1756.0;

export const LEGACY_QUESTION_Y_22 = [
  653, 705, 758, 810, 863, 915, 968, 1020, 1073, 1126,
  1178, 1231, 1283, 1336, 1388, 1441, 1494, 1546, 1599, 1651,
  1704, 1756,
];

/** Posições Y das n primeiras questões (espelha omr/template.py). */
export function questionYFor(n: number): number[] {
  const count = Math.max(1, Math.min(MAX_QUESTIONS_PER_SUBJECT, Math.round(n)));
  if (count === 22) return [...LEGACY_QUESTION_Y_22];
  if (count === 1) return [FIRST_QUESTION_Y];
  const step = (LAST_QUESTION_Y - FIRST_QUESTION_Y) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round((FIRST_QUESTION_Y + i * step) * 10) / 10
  );
}

// Compatibilidade: grid padrão (22)
export const QUESTION_Y = LEGACY_QUESTION_Y_22;

// ─── Modo coluna única (1 disciplina) ───
export const SINGLE_TITLE_CENTER_X = 724;
export const SINGLE_NUM_X = 404;
export const SINGLE_X = [514.0, 654.0, 794.0, 934.0];
export const SINGLE_FIRST_Y = 635.0;
export const SINGLE_LAST_Y = 1805.0;
export const SINGLE_BUBBLE_RADIUS = 15.0;
const _MIN_STEP_SINGLE = 34.0;
export const MAX_QUESTIONS_SINGLE = Math.floor((SINGLE_LAST_Y - SINGLE_FIRST_Y) / _MIN_STEP_SINGLE) + 1; // 35

/** Posições Y das n questões no modo coluna única (espelha template.py). */
export function singleQuestionYFor(n: number): number[] {
  const count = Math.max(1, Math.min(MAX_QUESTIONS_SINGLE, Math.round(n)));
  if (count === 1) return [SINGLE_FIRST_Y];
  const step = (SINGLE_LAST_Y - SINGLE_FIRST_Y) / (count - 1);
  return Array.from({ length: count }, (_, i) =>
    Math.round((SINGLE_FIRST_Y + i * step) * 10) / 10
  );
}

export const PORTUGUESE_X = [349, 438.5, 528, 618];
export const MATHEMATICS_X = [900, 990.5, 1080, 1169.5];

// ─── Modelo do cartão ───

export interface BubbleOption {
  question: number;
  alternative: string;
  centerX: number;
  centerY: number;
  radius: number;
}

export interface SubjectModel {
  id: 'portugues' | 'matematica';
  title: string;
  centerX: number;
  centerY: number;
  alternatives: { letter: string; x: number }[];
  headerY: number;
  questionNumX: number;
  questions: { y: number; options: BubbleOption[] }[];
}

export interface CardTemplate {
  width: number;
  height: number;
  aruco: {
    size: number;
    ids: typeof ARUCO_IDS;
    centers: typeof ARUCO_CENTERS;
  };
  identification: {
    aluno: typeof ALUNO_BOX;
    turma: typeof TURMA_BOX;
  };
  divider: { x: number; y0: number; y1: number; width: number };
  subjects: SubjectModel[];
}

export function buildCardTemplate(): CardTemplate {
  const makeSubject = (
    id: 'portugues' | 'matematica',
    xs: number[],
    titleX: number,
    questionNumX: number
  ): SubjectModel => ({
    id,
    title: SUBJECT_TITLES[id].text,
    centerX: titleX,
    centerY: SUBJECT_TITLES[id].centerY,
    alternatives: xs.map((x, c) => ({ letter: String.fromCharCode(65 + c), x })),
    headerY: HEADER_Y,
    questionNumX,
    questions: QUESTION_Y.map((y, q) => ({
      y,
      options: xs.map((x, c) => ({
        question: q + 1,
        alternative: String.fromCharCode(65 + c),
        centerX: x,
        centerY: y,
        radius: BUBBLE_RADIUS,
      })),
    })),
  });

  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    aruco: { size: ARUCO_MARKER_SIZE, ids: ARUCO_IDS, centers: ARUCO_CENTERS },
    identification: { aluno: ALUNO_BOX, turma: TURMA_BOX },
    divider: { x: DIVIDER_X, y0: DIVIDER_Y0, y1: DIVIDER_Y1, width: 5 },
    subjects: [
      makeSubject('portugues', PORTUGUESE_X, SUBJECT_TITLES.portugues.centerX, QUESTION_NUM_X.portugues),
      makeSubject('matematica', MATHEMATICS_X, SUBJECT_TITLES.matematica.centerX, QUESTION_NUM_X.matematica),
    ],
  };
}
