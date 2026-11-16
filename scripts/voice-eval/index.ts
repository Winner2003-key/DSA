#!/usr/bin/env tsx
// npm run voice:eval — measures what the intent matcher does with a mangled transcript.
//
//   npm run voice:eval                       # the built-in distortions, over the whole book
//   npm run voice:eval -- --cases fichier.tsv  # real recordings: "what was heard<TAB>what was meant"
//   npm run voice:eval -- --answers           # the Tireur's closed set (oui / non / je ne sais pas / question)
//   npm run voice:eval -- --answers --sweep   # the same, over a range of thresholds
//
// Why it exists: every change to `phoneticKey` or to INTENT_THRESHOLDS looks
// plausible on paper. The first one tried here (folding French nasal vowels, as
// carnetdevente does) read well and measured *worse* — at 1087 names, collapsing
// "an/en/on" throws away more than it joins. Nothing goes into the matcher now
// without a number from this script, and a line of --cases from a real player is
// worth more than every invented distortion below.

import { readFileSync } from 'node:fs';
import { GraphIndex, matchIntent, normalizeName } from '@dsa/core';
import type { IntentContext } from '@dsa/core';
import { ANSWER_MATCH, matchClosedSet } from '@dsa/voice';
import { buildBook } from '../src/book';
import { RECALL_CASES, SAFETY_CASES, scoreAnswers, type AnswerCase, type Want } from './answers';

interface Case {
  /** What speech-to-text wrote. */
  heard: string;
  /** The name it should resolve to. */
  want: string;
}

function knownNames(): string[] {
  const { data } = buildBook({ allowUnsalted: true });
  const ix = new GraphIndex(data, { approvedOnly: false });
  const names = new Set<string>();
  for (const node of ix.nodes()) if (node.nodeType === 'CHARACTER') names.add(node.label);
  for (const character of data.characters) {
    names.add(character.name);
    for (const alias of character.aliases) names.add(alias);
  }
  return [...names];
}

/** Distortions a French recogniser really produces on these names. */
const DISTORTIONS: { label: string; apply: (name: string) => string }[] = [
  { label: 'dit exactement', apply: (n) => n },
  { label: 'dans une phrase', apply: (n) => `est-ce que c'est ${n.toLowerCase()}` },
  {
    label: 'orthographe proche',
    apply: (n) => n.toLowerCase().replace(/om\b/, 'on').replace(/ph/, 'f').replace(/k/, 'c').replace(/ss/, 's').replace(/ou/, 'u'),
  },
  { label: 'derniere lettre perdue', apply: (n) => (n.length > 4 ? n.toLowerCase().slice(0, -1) : n.toLowerCase()) },
];

function score(cases: Case[], names: string[]): { hit: number; wrong: number; unresolved: number; misses: string[] } {
  const ctx: IntentContext = { role: 'DECOUVREUR', prompt: null, answerLabels: [], knownNames: names, path: [] };
  let hit = 0;
  let wrong = 0;
  let unresolved = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const intent = matchIntent(c.heard, ctx);
    if (intent.type === 'GUESS' && normalizeName(intent.name) === normalizeName(c.want)) {
      hit++;
    } else if (intent.type === 'GUESS') {
      wrong++;
      if (misses.length < 12) misses.push(`${c.heard} → ${intent.name} (attendu ${c.want})`);
    } else {
      unresolved++;
      if (misses.length < 12) misses.push(`${c.heard} → ${intent.type} (attendu ${c.want})`);
    }
  }
  return { hit, wrong, unresolved, misses };
}

function line(label: string, cases: Case[], names: string[]): void {
  const { hit, wrong, unresolved, misses } = score(cases, names);
  const pc = ((100 * hit) / cases.length).toFixed(1);
  process.stdout.write(`${label.padEnd(26)} trouvé ${pc.padStart(5)} %   faux ${String(wrong).padStart(3)}   non résolu ${String(unresolved).padStart(4)}\n`);
  for (const m of misses) process.stdout.write(`    ${m}\n`);
}

function readCases(file: string): Case[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => {
      const [heard, want] = l.split('\t');
      if (heard === undefined || want === undefined) throw new Error(`Ligne mal formée (il faut « entendu<TAB>voulu ») : ${l}`);
      return { heard: heard.trim(), want: want.trim() };
    });
}

// ---------------------------------------------------------------------------
// The Tireur's closed set

function answerReport(): void {
  const out = (s: string) => process.stdout.write(s);
  out('Le Tireur : ce que le matcher fait de ce que Whisper écrit\n');
  out('(transcriptions inventées — vingt lignes d’un vrai joueur valent mieux)\n\n');

  for (const [label, cases] of [
    ['comprises', RECALL_CASES],
    ['refusées', SAFETY_CASES],
  ] as [string, readonly AnswerCase[]][]) {
    const s = scoreAnswers(cases);
    const pc = ((100 * s.right) / s.total).toFixed(1);
    out(`${label.padEnd(12)} ${String(s.right).padStart(3)}/${String(s.total).padEnd(3)} ${pc.padStart(5)} %`);
    out(`   réponse fausse ${String(s.wrong.length).padStart(2)}   non comprises ${String(s.missed.length).padStart(2)}\n`);
    for (const w of s.wrong) out(`    ✗ FAUX  « ${w.heard} » → ${w.got} (voulu ${w.want})\n`);
    for (const m of s.missed) out(`    · raté  « ${m.heard} » (voulu ${m.want})\n`);
    out('\n');
  }
}

/**
 * The same two tables over a range of thresholds, so a constant is never moved
 * on taste. `score` is the one that matters: too low and a book name becomes an
 * answer, too high and a real "oui" is refused.
 */
function answerSweep(): void {
  const out = (s: string) => process.stdout.write(s);
  const want = (c: AnswerCase, score: number): Want => {
    const m = matchClosedSet(c.heard, { score });
    if (m === null) return 'RIEN';
    return m.value === 'JE_NE_SAIS_PAS' ? 'JE_NE_SAIS_PAS' : m.value === 'REWIND' ? 'REWIND' : m.value;
  };
  out(`seuil courant : score ${ANSWER_MATCH.score}, token ${ANSWER_MATCH.token}, marge ${ANSWER_MATCH.margin}\n`);
  out('  score   comprises        refusées à tort   réponses fausses\n');
  for (const score of [0.7, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.88, 0.92]) {
    // The closed set alone, with the exact spellings of `@dsa/core` taken out of
    // the picture: this measures the fuzzy layer, which is what the number tunes.
    const recall = RECALL_CASES.filter((c) => want(c, score) === c.want).length;
    const falseAccepts = SAFETY_CASES.filter((c) => want(c, score) !== 'RIEN');
    const marker = score === ANSWER_MATCH.score ? ' ←' : '';
    out(
      `  ${score.toFixed(2)}    ${String(recall).padStart(3)}/${RECALL_CASES.length}` +
        `          ${String(RECALL_CASES.length - recall).padStart(3)}` +
        `               ${String(falseAccepts.length).padStart(3)}${marker}\n`,
    );
    for (const f of falseAccepts) out(`           ✗ « ${f.heard} » → ${want(f, score)}\n`);
  }
  out('\n');
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    process.stdout.write('Usage : npm run voice:eval [-- --cases fichier.tsv] [-- --answers [--sweep]]\n');
    return;
  }

  if (argv.includes('--answers')) {
    answerReport();
    if (argv.includes('--sweep')) answerSweep();
    return;
  }
  const names = knownNames();
  process.stdout.write(`${names.length} noms connus\n\n`);

  const casesFlag = argv.indexOf('--cases');
  if (casesFlag >= 0) {
    const file = argv[casesFlag + 1];
    if (file === undefined) throw new Error('--cases attend un fichier');
    const cases = readCases(file);
    line(`enregistrements (${cases.length})`, cases, names);
    return;
  }

  for (const d of DISTORTIONS) {
    line(d.label, names.map((n) => ({ heard: d.apply(n), want: n })), names);
  }
}

main();
