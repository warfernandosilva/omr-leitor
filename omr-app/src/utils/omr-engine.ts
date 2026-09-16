import {
  TOTAL_QUESTIONS,
  QUESTIONS_PER_SUBJECT,
  VALID_ANSWERS,
  readCard,
  readCardArUco,
} from './omr-pure';

export type DetectionMode = 'ARUCO' | 'LEGACY';

export interface OMRAnswer {
  question: number;
  answer: string | null;
  confidence: number;
  isDuplicate: boolean;
  isUncertain: boolean;
  detectionMode: DetectionMode;
}

// Modelo de dados final (spec §17): por disciplina, questões 1..22.
export interface OMRSubjectData {
  1: string;
  2: string;
  3: string;
  4: string;
  5: string;
  6: string;
  7: string;
  8: string;
  9: string;
  10: string;
  11: string;
  12: string;
  13: string;
  14: string;
  15: string;
  16: string;
  17: string;
  18: string;
  19: string;
  20: string;
  21: string;
  22: string;
}

export interface OMRCardData {
  aluno: string;
  turma: string;
  portugues: OMRSubjectData;
  matematica: OMRSubjectData;
}

export interface OMRProcessingResult {
  answers: Record<number, string>;
  details: OMRAnswer[];
  blankQuestions: number[];
  duplicateQuestions: number[];
  lowConfidence: number[];
  data: OMRCardData;
  success: boolean;
  error?: string;
}

import { FLOOR, MARGIN as UNCERTAIN_MARGIN } from './omr-config';

function classifyQuestion(ratios: number[], detectionMode: DetectionMode): OMRAnswer {
  const mx = Math.max(...ratios);
  const second = [...ratios].sort((a, b) => b - a)[1] ?? 0;
  const marked: number[] = [];
  for (let c = 0; c < 4; c++) {
    if (ratios[c] >= FLOOR) marked.push(c);
  }

  if (marked.length === 0) {
    return { question: -1, answer: null, confidence: mx, isDuplicate: false, isUncertain: false, detectionMode };
  }

  if (marked.length >= 2) {
    return { question: -1, answer: null, confidence: mx, isDuplicate: true, isUncertain: false, detectionMode };
  }

  const idx = marked[0];
  const diff = ratios[idx] - second;
  if (diff >= UNCERTAIN_MARGIN) {
    return {
      question: -1,
      answer: VALID_ANSWERS[idx],
      confidence: ratios[idx],
      isDuplicate: false,
      isUncertain: false,
      detectionMode,
    };
  }
  return { question: -1, answer: null, confidence: ratios[idx], isDuplicate: false, isUncertain: true, detectionMode };
}

function setSubjectAnswer(target: OMRSubjectData, q: number, answer: string): void {
  (target as unknown as Record<number, string>)[q] = answer;
}

function emptySubject(): OMRSubjectData {
  const out = {} as Record<number, string>;
  for (let q = 1; q <= QUESTIONS_PER_SUBJECT; q++) out[q] = '';
  return out as unknown as OMRSubjectData;
}

export async function processImage(
  imageSource: HTMLImageElement | HTMLCanvasElement,
  onProgress?: (percent: number) => void
): Promise<OMRProcessingResult> {
  const fail = (error: string): OMRProcessingResult => ({
    answers: {},
    details: [],
    blankQuestions: [],
    duplicateQuestions: [],
    lowConfidence: [],
    data: { aluno: '', turma: '', portugues: emptySubject(), matematica: emptySubject() },
    success: false,
    error,
  });

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    let imgW: number, imgH: number;
    if (imageSource instanceof HTMLCanvasElement) {
      imgW = imageSource.width;
      imgH = imageSource.height;
    } else {
      const maxDim = 2400;
      const s = Math.min(
        maxDim / (imageSource.naturalWidth || imageSource.width),
        maxDim / (imageSource.naturalHeight || imageSource.height),
        1
      );
      imgW = Math.round((imageSource.naturalWidth || imageSource.width) * s);
      imgH = Math.round((imageSource.naturalHeight || imageSource.height) * s);
    }

    canvas.width = imgW;
    canvas.height = imgH;
    ctx.drawImage(imageSource, 0, 0, imgW, imgH);
    const imgData = ctx.getImageData(0, 0, imgW, imgH);
    const data = imgData.data;

    onProgress?.(5);

    // Tentar ArUco primeiro (novo cartão), depois legacy (cartão antigo)
    let result = readCardArUco(data, imgW, imgH);
    let detectionMode: DetectionMode = 'ARUCO';

    if (!result) {
      // Fallback para detecção legacy (quadrados pretos)
      const legacyResult = readCard(data, imgW, imgH);
      if (legacyResult) {
        result = { ...legacyResult, qr: null };
        detectionMode = 'LEGACY';
      } else {
        return fail(
          'GABARITO NÃO RECONHECIDO: não foi possível localizar os marcadores de calibração. Posicione o cartão inteiro na foto, sobre uma superfície plana, com boa iluminação e sem reflexos.'
        );
      }
    }

    onProgress?.(40);

    const details: OMRAnswer[] = [];
    const answers: Record<number, string> = {};
    const duplicateQuestions: number[] = [];
    const lowConfidence: number[] = [];
    const dataModel: OMRCardData = { aluno: '', turma: '', portugues: emptySubject(), matematica: emptySubject() };

    const subjects: { ratios: number[][]; target: OMRSubjectData }[] = [
      { ratios: result.portuguesRatios, target: dataModel.portugues },
      { ratios: result.matematicaRatios, target: dataModel.matematica },
    ];

    for (let ti = 0; ti < 2; ti++) {
      const subjectRatios = subjects[ti].ratios;
      const subjectOffset = ti * QUESTIONS_PER_SUBJECT;

      for (let q = 0; q < QUESTIONS_PER_SUBJECT; q++) {
        const raw = classifyQuestion(subjectRatios[q], detectionMode);
        const qGlobal = q + 1 + subjectOffset;

        const detail: OMRAnswer = {
          question: qGlobal,
          answer: raw.answer,
          confidence: raw.confidence,
          isDuplicate: raw.isDuplicate,
          isUncertain: raw.isUncertain,
          detectionMode,
        };
        details.push(detail);

        if (raw.answer) {
          answers[qGlobal] = raw.answer;
          setSubjectAnswer(subjects[ti].target, q + 1, raw.answer);
        }
        if (raw.isDuplicate) duplicateQuestions.push(qGlobal);
        if (raw.isUncertain || (raw.answer && raw.confidence < 0.4)) lowConfidence.push(qGlobal);

        onProgress?.(40 + ((ti * QUESTIONS_PER_SUBJECT + q + 1) / TOTAL_QUESTIONS) * 55);
      }
    }

    onProgress?.(100);

    const blankQuestions = details
      .filter(d => d.answer === null && !d.isDuplicate)
      .map(d => d.question);
    const uniqueLowConfidence = [...new Set(lowConfidence)].filter(q => !duplicateQuestions.includes(q));

    return {
      answers,
      details,
      blankQuestions,
      duplicateQuestions: [...new Set(duplicateQuestions)],
      lowConfidence: uniqueLowConfidence,
      data: dataModel,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'desconhecido';
    return fail(`Erro ao processar: ${msg}. Tente uma foto mais nítida.`);
  }
}