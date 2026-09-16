import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildGraphData, parseSpine } from '@dsa/core';
import { EnvError, loadEnv, parseEnvFile, readEnvFile, resolveEnv } from '../src/env';
import { buildFixture, SPINE } from './fixtures';

describe('parseEnvFile', () => {
  it('reads plain, quoted, exported and commented lines', () => {
    const vars = parseEnvFile(
      [
        '# a comment',
        '',
        'SUPABASE_URL=https://abc.supabase.co',
        'export SUPABASE_SERVICE_ROLE_KEY="ey.some.key"',
        "DSA_ID_SALT='2f1c…'",
        'WITH_COMMENT=value # trailing',
        'EMPTY=',
        'not a variable',
      ].join('\n'),
    );
    expect(vars).toEqual({
      SUPABASE_URL: 'https://abc.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'ey.some.key',
      DSA_ID_SALT: '2f1c…',
      WITH_COMMENT: 'value',
      EMPTY: '',
    });
  });

  it('returns nothing when the file does not exist', () => {
    expect(readEnvFile(join(tmpdir(), 'dsa-no-such-env-file'))).toEqual({});
  });
});

describe('resolveEnv', () => {
  const full = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'key', DSA_ID_SALT: 'salt' };

  it('reads the file and lets the process environment win', () => {
    expect(resolveEnv(full, {})).toEqual({ supabaseUrl: 'https://abc.supabase.co', serviceRoleKey: 'key', idSalt: 'salt' });
    expect(resolveEnv(full, { DSA_ID_SALT: 'from-shell' }).idSalt).toBe('from-shell');
  });

  it('refuses to run without the salt, and says where to find every missing value', () => {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = full;
    try {
      resolveEnv({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {});
      throw new Error('expected EnvError');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const e = error as EnvError;
      expect(e.missing).toEqual(['DSA_ID_SALT']);
      expect(e.message).toContain('DSA_ID_SALT');
      expect(e.message).toContain('crypto.randomUUID()');
      expect(e.message).toContain('IMPORT_GUIDE.md');
    }
  });

  it('lists every missing variable at once, with no credentials at all', () => {
    const error = (() => {
      try {
        resolveEnv({}, {});
        return null;
      } catch (e) {
        return e as EnvError;
      }
    })();
    expect(error?.missing).toEqual(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DSA_ID_SALT']);
    expect(error?.message).toContain('scripts/.env');
  });

  it('treats blank and whitespace-only values as missing', () => {
    expect(() => resolveEnv({ ...full, DSA_ID_SALT: '   ' }, {})).toThrow(EnvError);
    expect(() => resolveEnv({ ...full, SUPABASE_SERVICE_ROLE_KEY: '' }, {})).toThrow(EnvError);
  });

  it('only requires what the command needs', () => {
    expect(resolveEnv({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' }, {}, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']).idSalt).toBe('');
  });
});

describe('loadEnv', () => {
  it('reads scripts/.env from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsa-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, 'SUPABASE_URL=https://x.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=k\nDSA_ID_SALT=s\n');
    expect(loadEnv(['SUPABASE_URL'], file).supabaseUrl).toBe('https://x.supabase.co');
  });
});

describe('the graph refuses to be built without a salt', () => {
  it('throws for a real graph, and names DSA_ID_SALT', () => {
    expect(() => buildFixture({ idSalt: null })).toThrow(/needs an id salt/);
    expect(() => buildGraphData('livre', parseSpine(SPINE, 'spine.dsa'), [])).toThrow(/DSA_ID_SALT/);
    expect(() => buildFixture({ idSalt: null, allowUnsalted: true })).not.toThrow();
  });

  it('gives different ids for different salts, and the same ids for the same salt', () => {
    const a = buildFixture({ idSalt: 'salt-a' }).data;
    const b = buildFixture({ idSalt: 'salt-b' }).data;
    const again = buildFixture({ idSalt: 'salt-a' }).data;
    expect(a.nodes.map((n) => n.id)).not.toEqual(b.nodes.map((n) => n.id));
    expect(a.nodes.map((n) => n.id)).toEqual(again.nodes.map((n) => n.id));
    expect(a.nodes.map((n) => n.nodeKey)).toEqual(b.nodes.map((n) => n.nodeKey));
  });
});
