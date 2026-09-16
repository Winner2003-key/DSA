import { describe, expect, it } from 'vitest';
import { UsageError, parseExportArgs, parseImportArgs, parsePages, parseValidateArgs } from '../src/args';

describe('parseImportArgs', () => {
  it('is a dry run unless --apply is given', () => {
    expect(parseImportArgs([])).toMatchObject({ graph: 'livre', dryRun: true, pages: null, approve: false, publish: false, prune: false });
    expect(parseImportArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseImportArgs(['--apply']).dryRun).toBe(false);
    expect(() => parseImportArgs(['--apply', '--dry-run'])).toThrow(UsageError);
  });

  it('reads values with a space or an equals sign', () => {
    expect(parseImportArgs(['--graph', 'livre', '--name', 'DSA — Découverte Sans Alphabet']).name).toBe('DSA — Découverte Sans Alphabet');
    expect(parseImportArgs(['--graph=autre']).graph).toBe('autre');
    expect(parseImportArgs(['--json=out.json']).json).toBe('out.json');
  });

  it('parses --pages as a list or a range, sorted and de-duplicated', () => {
    expect(parseImportArgs(['--pages', '23,8,9,8']).pages).toEqual([8, 9, 23]);
    expect(parsePages('8-11,23')).toEqual([8, 9, 10, 11, 23]);
    expect(() => parsePages('huit')).toThrow(UsageError);
    expect(() => parsePages('12-8')).toThrow(UsageError);
    expect(() => parsePages('')).toThrow(UsageError);
  });

  it('refuses a typo instead of silently running a dry run', () => {
    expect(() => parseImportArgs(['--aply'])).toThrow(/option inconnue/);
    expect(() => parseImportArgs(['apply'])).toThrow(/argument inattendu/);
    expect(() => parseImportArgs(['--pages'])).toThrow(/attend une valeur/);
    expect(() => parseImportArgs(['--batch-size', 'beaucoup'])).toThrow(/nombre/);
  });

  it('carries the review and publication flags', () => {
    expect(parseImportArgs(['--pages', '23', '--approve', '--publish', '--prune', '--apply'])).toMatchObject({
      pages: [23],
      approve: true,
      publish: true,
      prune: true,
      dryRun: false,
    });
  });
});

describe('parseValidateArgs and parseExportArgs', () => {
  it('parses the validation flags', () => {
    expect(parseValidateArgs([])).toMatchObject({ graph: 'livre', approved: false, json: null });
    expect(parseValidateArgs(['--approved', '--json', 'r.json'])).toMatchObject({ approved: true, json: 'r.json' });
    expect(() => parseValidateArgs(['--apply'])).toThrow(UsageError);
  });

  it('parses the export flags', () => {
    expect(parseExportArgs(['--out', 'sauvegarde.json'])).toMatchObject({ graph: 'livre', out: 'sauvegarde.json' });
    expect(parseExportArgs([]).out).toBeNull();
    expect(() => parseExportArgs(['--out'])).toThrow(/attend une valeur/);
  });
});
