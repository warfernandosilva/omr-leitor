import { describe, expect, it } from 'vitest';
import { anchorLabelFor } from './read-stages';

describe('anchorLabelFor', () => {
  it('simulado usa as réguas', () => {
    expect(anchorLabelFor({ templateType: 'simulado' })).toBe('Detecção das réguas da tabela');
  });
  it('herby usa o QR duplo', () => {
    expect(anchorLabelFor({ templateType: 'herby' })).toBe('Leitura do QR duplo');
  });
  it('padrão e ausente usam âncoras', () => {
    expect(anchorLabelFor({ templateType: 'padrao' })).toBe('Detecção das âncoras');
    expect(anchorLabelFor(null)).toBe('Detecção das âncoras');
    expect(anchorLabelFor(undefined)).toBe('Detecção das âncoras');
  });
});
