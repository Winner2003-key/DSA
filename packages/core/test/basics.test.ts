import { describe, expect, it } from 'vitest';
import {
  KEY_NAMESPACE,
  allowedClassesFor,
  answerClass,
  answerSlug,
  characterKey,
  collisionKey,
  edgeId,
  nodeId,
  normalizeName,
  normalizeText,
  slugify,
  spineChildKey,
  stripAccents,
  tokenize,
  treeChildKey,
} from '../src/index';
import type { Prompt } from '../src/index';

describe('normalize', () => {
  it('lowercases, strips accents and ligatures', () => {
    expect(stripAccents('Œuvre Æsir ÏËÜ ç')).toBe('OEuvre AEsir IEU c');
    expect(normalizeText('CŒUR de Caïn, Ismaël & Noë')).toBe('coeur de cain ismael noe');
  });

  it('unifies apostrophes and collapses punctuation and whitespace', () => {
    expect(normalizeText('  Est-ce que c’est   ÇA ?! ')).toBe("est ce que c'est ca");
    expect(normalizeText("FILS D ' AGAR")).toBe("fils d'agar");
    expect(normalizeText('…!?')).toBe('');
  });

  it('normalizeName ignores hyphens, spaces and apostrophes', () => {
    expect(normalizeName('Jésus Christ')).toBe(normalizeName('JESUS-CHRIST'));
    expect(normalizeName('Ben-Ammi')).toBe('benammi');
    expect(normalizeName('CAÏN')).toBe(normalizeName('cain'));
    expect(normalizeName('ABRAHAM')).not.toBe(normalizeName('ABRAM'));
  });

  it('tokenize splits on apostrophes', () => {
    expect(tokenize("C'est ça ?")).toEqual(['c', 'est', 'ca']);
  });
});

describe('keys', () => {
  it('slugify', () => {
    expect(slugify('PENTATEUQUE (HOMMES)')).toBe('pentateuque-hommes');
    expect(slugify("FILS D'AGAR")).toBe('fils-d-agar');
    expect(slugify('  --LES 3 PREMIERS-- ')).toBe('les-3-premiers');
    expect(slugify('Œil — de  bœuf !')).toBe('oeil-de-boeuf');
    expect(slugify('VERSÉ DANS LES ÉCRITURES')).toBe('verse-dans-les-ecritures');
  });

  it('answerSlug', () => {
    expect(answerSlug('OUI')).toBe('oui');
    expect(answerSlug('NON')).toBe('non');
    expect(answerSlug('OUIOUIOUIOUI')).toBe('ouioui');
    expect(answerSlug('NONONONO')).toBe('nonnon');
    expect(answerSlug('JE NE SAIS PAS')).toBe('je-ne-sais-pas');
    expect(answerSlug('CODE INCONNU (JOB)')).toBe('code-inconnu-job');
  });

  it('builds node keys', () => {
    expect(spineChildKey(null, 'DÉBUT', 'ANCIEN')).toBe('ancien');
    expect(spineChildKey('ancien[oui]/homme[oui]/pentateuque', 'NONONONON', 'LIVRE DE SAMUEL')).toBe('ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel');
    expect(treeChildKey('a', 'LIE A ADAM')).toBe('a/lie-a-adam');
    expect(characterKey('a', 'Le meurtrier', 'CAÏN')).toBe('a/le-meurtrier--cain');
    expect(characterKey('a', null, 'ADAM')).toBe('a/adam');
    expect(collisionKey('a/b', 1)).toBe('a/b');
    expect(collisionKey('a/b', 3)).toBe('a/b~3');
  });

  it('UUID v5 ids are deterministic and match independent values (Python uuid.uuid5)', () => {
    expect(KEY_NAMESPACE).toBe('6f1f3f7e-0d7b-4f6c-9d7e-5a0c2b1d4e9a');
    expect(nodeId('mini', 'dsa')).toBe('745fb64b-de61-5a63-b6c9-8ea8ca520f74');
    expect(nodeId('mini', 'ancien')).toBe('198e148c-bd78-51e2-80ed-fe52ba6e2dff');
    expect(nodeId('mini', 'ancien[oui]/homme[oui]/pentateuque[oui]/pentateuque-hommes/lie-a-adam/classe-1/le-meurtrier--cain')).toBe('0ba931f7-fc3d-5e80-bb26-846bbfbb21d4');
    expect(nodeId('mini', 'ancien[oui]/homme[oui]/pentateuque[nonnon]/livre-de-samuel')).toBe('0c13378b-ba7d-5621-ac7e-381f1de65d41');
    expect(edgeId('mini', 'dsa', 'ancien')).toBe('26622408-81fe-5975-a944-f3f3e4bfe59a');
    expect(nodeId('mini', 'ancien')).toBe(nodeId('mini', 'ancien'));
    expect(nodeId('livre', 'ancien', { allowUnsalted: true })).not.toBe(nodeId('mini', 'ancien'));
  });
});

describe('answers', () => {
  it.each([
    ['OUI', 'OUI'],
    ['oui', 'OUI'],
    ['NON', 'NON'],
    ['OUIOUI', 'OUI_REPETE'],
    ['OUIOUIOUI', 'OUI_REPETE'],
    ['OUIOUIOUIOUI', 'OUI_REPETE'],
    ['oui oui', 'OUI_REPETE'],
    ['NONNON', 'NON_REPETE'],
    ['NONONO', 'NON_REPETE'],
    ['NONONONO', 'NON_REPETE'],
    ['NONONONON', 'NON_REPETE'],
    ['non, non', 'NON_REPETE'],
    ['JE NE SAIS PAS', 'JE_NE_SAIS_PAS'],
    ['je ne sais pas', 'JE_NE_SAIS_PAS'],
    ['NO', 'AUTRE'],
    ['NONO', 'AUTRE'],
    ['OUI NON', 'AUTRE'],
    ['DÉBUT', 'AUTRE'],
    ['CODE INCONNU (JOB)', 'AUTRE'],
  ])('answerClass(%s) = %s', (label, cls) => {
    expect(answerClass(label)).toBe(cls);
  });

  it('allowedClassesFor', () => {
    const spine: Prompt = { promptNodeId: 'q', atNodeId: 'q', text: 'HOMME', kind: 'SPINE', answerClasses: ['OUI', 'JE_NE_SAIS_PAS'] };
    expect(allowedClassesFor(spine)).toEqual(['OUI', 'JE_NE_SAIS_PAS']);
    expect(allowedClassesFor({ ...spine, kind: 'CHILD', answerClasses: [] })).toEqual(['OUI', 'NON']);
  });
});
