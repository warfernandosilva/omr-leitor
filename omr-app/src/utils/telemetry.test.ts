import { beforeEach, describe, expect, it } from 'vitest';
import {
  TELEMETRY_MAX_ENTRIES,
  clearTelemetryLog,
  isTelemetryEnabled,
  logOmrTelemetry,
  readTelemetryLog,
  setTelemetryEnabled,
  telemetryCsv,
} from './telemetry';

beforeEach(() => {
  localStorage.clear();
});

describe('telemetria opt-in', () => {
  it('começa desligada e não registra nada', () => {
    expect(isTelemetryEnabled()).toBe(false);
    logOmrTelemetry({ success: true, examId: 'x' });
    expect(readTelemetryLog()).toEqual([]);
  });

  it('registra quando ligada', () => {
    setTelemetryEnabled(true);
    logOmrTelemetry({ success: true, examId: 'prova-1', page: 1, readCount: 22 });
    const log = readTelemetryLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ success: true, examId: 'prova-1', page: 1, readCount: 22 });
    expect(typeof log[0].ts).toBe('string');
  });

  it('mantém no máximo o limite configurado', () => {
    setTelemetryEnabled(true);
    for (let i = 0; i < TELEMETRY_MAX_ENTRIES + 5; i += 1) {
      logOmrTelemetry({ success: true, readCount: i });
    }
    const log = readTelemetryLog();
    expect(log).toHaveLength(TELEMETRY_MAX_ENTRIES);
    expect(log[log.length - 1].readCount).toBe(TELEMETRY_MAX_ENTRIES + 4);
  });

  it('limpa os registros', () => {
    setTelemetryEnabled(true);
    logOmrTelemetry({ success: false, errorKind: 'network' });
    clearTelemetryLog();
    expect(readTelemetryLog()).toEqual([]);
  });
});

describe('telemetryCsv', () => {
  it('gera cabeçalho e linhas', () => {
    const csv = telemetryCsv([{ ts: '2026-01-01T00:00:00Z', success: true, page: 1 }]);
    const [header, row] = csv.split('\n');
    expect(header.split(',')).toContain('ts');
    expect(header.split(',')).toContain('errorKind');
    expect(row).toContain('2026-01-01T00:00:00Z');
    expect(row).toContain('true');
  });

  it('escapa vírgula, aspas e quebra de linha', () => {
    const csv = telemetryCsv([{
      ts: 't',
      success: false,
      error: 'falha, com "aspas"\ne linha',
    }]);
    expect(csv).toContain('"falha, com ""aspas""\ne linha"');
  });
});
