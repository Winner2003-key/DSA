import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { bookOutline } from '@dsa/core';
import type { OutlineSection, Section } from '@dsa/core';

import { AppText } from './app-text';
import { PrimaryButton } from './buttons';
import { Sheet } from './sheet';
import { fr } from '@/i18n/fr';
import { lightFeedback } from '@/lib/haptics';
import type { BookSection } from '@/services/types';
import { useTheme } from '@/theme';
import { BookOpen, Check } from './icon';

export interface ScopePickerProps {
  visible: boolean;
  sections: BookSection[];
  /** The section ids ticked when the sheet opens. */
  value: string[];
  onClose: () => void;
  onConfirm: (scope: string[]) => void;
  loading?: boolean;
}

/** `dsa_list_sections` rows as `@dsa/core` reads them. */
function asSections(rows: readonly BookSection[]): Section[] {
  return rows.map((row) => ({
    nodeId: row.node_id,
    label: row.label,
    parentId: row.parent_id,
    depth: row.depth,
    characters: row.characters,
    nodeType: row.node_type ?? 'CATEGORY',
    answerLabel: row.answer_label ?? null,
  }));
}

/**
 * The book's outline, as the picker shows it: ANCIEN and NOUVEAU, each with its
 * HOMME and FEMME, and under them the lists the book prints (PENTATEUQUE, LES 3
 * PREMIERS, LIVRE DE SAMUEL…). The rule is in `@dsa/core`; the French wording of
 * the four branches is here, with the rest of the interface.
 */
export function pickerRows(sections: readonly BookSection[]): OutlineSection[] {
  return bookOutline(asSections(sections), { splits: fr.setup.scopeSplits });
}

/** Rows whose whole content is already in `scope`, deepest kept out. */
function pickedFrom(rows: readonly OutlineSection[], scope: readonly string[]): string[] {
  const chosen = new Set(scope);
  const keys: string[] = [];
  const walk = (list: readonly OutlineSection[]) => {
    for (const row of list) {
      if (row.nodeIds.length > 0 && row.nodeIds.every((id) => chosen.has(id))) keys.push(row.key);
      else walk(row.children);
    }
  };
  walk(rows);
  return keys;
}

/**
 * What « Nouvelle partie » writes under the line: the names of the chosen parts,
 * as the sommaire calls them (« Ancien Testament », « Hommes »…). Empty for the
 * whole book.
 */
export function scopeTitles(sections: readonly BookSection[], scope: readonly string[]): string[] {
  if (scope.length === 0) return [];
  const rows = pickerRows(sections);
  const keys = new Set(pickedFrom(rows, scope));
  const labels: string[] = [];
  const walk = (list: readonly OutlineSection[]) => {
    for (const row of list) {
      if (keys.has(row.key)) labels.push(row.label);
      else walk(row.children);
    }
  };
  walk(rows);
  // A scope the outline cannot name (an older server, or a part that has since
  // moved) is still shown, with the book's own labels.
  return labels.length > 0 ? labels : sections.filter((s) => scope.includes(s.node_id)).map((s) => s.label);
}

function descendants(row: OutlineSection): string[] {
  return row.children.flatMap((child) => [child.key, ...descendants(child)]);
}

/**
 * « Quelle partie du livre ? » — the table of contents, with the number of names
 * on each part and « Tout le livre » as the first choice. It shows labels and
 * counts only: no name, no clue, nothing a player couldn't read in the sommaire.
 */
export function ScopePicker({ visible, sections, value, onClose, onConfirm, loading = false }: ScopePickerProps) {
  const theme = useTheme();
  const rows = useMemo(() => pickerRows(sections), [sections]);
  const [picked, setPicked] = useState<string[]>(() => pickedFrom(rows, value));
  // The first two levels are the book's own map (ANCIEN/NOUVEAU, HOMME/FEMME):
  // they are open from the start, so the shape of the book is the first thing seen.
  const [open, setOpen] = useState<string[]>(() => rows.map((row) => row.key));

  // Re-open on the current choice, not on whatever was picked last time.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setPicked(pickedFrom(rows, value));
  }

  const chosen = new Set(picked);
  const total = useMemo(() => rows.reduce((sum, row) => sum + row.characters, 0), [rows]);
  const names = useMemo(() => {
    // A part and a part inside it can both be ticked; count each name once.
    let sum = 0;
    const walk = (list: readonly OutlineSection[], insideChosen: boolean) => {
      for (const row of list) {
        const inside = insideChosen || chosen.has(row.key);
        if (inside && !insideChosen) sum += row.characters;
        walk(row.children, inside);
      }
    };
    walk(rows, false);
    return sum;
  }, [picked, rows]);

  const toggle = (row: OutlineSection) => {
    lightFeedback();
    setPicked((current) => {
      const set = new Set(current);
      if (set.has(row.key)) set.delete(row.key);
      else {
        set.add(row.key);
        // A part covers everything inside it, so ticking it clears those.
        for (const key of descendants(row)) set.delete(key);
      }
      return [...set];
    });
  };

  const scopeOf = (keys: readonly string[]): string[] => {
    const wanted = new Set(keys);
    const ids: string[] = [];
    const walk = (list: readonly OutlineSection[]) => {
      for (const row of list) {
        if (wanted.has(row.key)) ids.push(...row.nodeIds);
        else walk(row.children);
      }
    };
    walk(rows);
    return [...new Set(ids)];
  };

  const line = (row: OutlineSection, depth: number, insideChosen: boolean): React.ReactNode => {
    const isChosen = chosen.has(row.key);
    const covered = insideChosen || isChosen;
    const expanded = open.includes(row.key);
    const hasChildren = row.children.length > 0;
    return (
      <View key={row.key}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.xs,
            paddingLeft: Math.min(depth, 4) * theme.space.md,
          }}
        >
          <Pressable
            testID={`scope-row-${row.key}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: covered, disabled: insideChosen }}
            accessibilityLabel={row.label}
            accessibilityHint={fr.setup.scopeNames(row.characters)}
            disabled={insideChosen}
            onPress={() => toggle(row)}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space.sm,
              minHeight: theme.touch.secondary,
              paddingHorizontal: theme.space.sm,
              borderRadius: theme.radius.field,
              backgroundColor: pressed ? theme.colors.surfaceRaised : 'transparent',
              opacity: insideChosen ? 0.6 : 1,
            })}
          >
            <Box checked={covered} testID={`scope-mark-${row.key}`} />
            <AppText variant="body" weight={depth === 0 ? 'semibold' : 'regular'} style={{ flex: 1 }}>
              {row.label}
            </AppText>
            <AppText variant="small" tone="soft">
              {row.characters}
            </AppText>
          </Pressable>

          {hasChildren ? (
            <Pressable
              testID={`scope-open-${row.key}`}
              accessibilityRole="button"
              accessibilityLabel={expanded ? fr.setup.scopeCollapse(row.label) : fr.setup.scopeExpand(row.label)}
              onPress={() =>
                setOpen((current) =>
                  current.includes(row.key) ? current.filter((key) => key !== row.key) : [...current, row.key],
                )
              }
              style={{ minWidth: 40, minHeight: theme.touch.secondary, alignItems: 'center', justifyContent: 'center' }}
            >
              <AppText variant="body" tone="soft">
                {expanded ? '▾' : '▸'}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {hasChildren && expanded ? (
          <View>{row.children.map((child) => line(child, depth + 1, covered))}</View>
        ) : null}
      </View>
    );
  };

  return (
    <Sheet
      visible={visible}
      title={fr.setup.scopeTitle}
      hint={fr.setup.scopeHint}
      onClose={onClose}
      testID="scope-picker"
    >
      {loading ? (
        <AppText variant="body" tone="soft" testID="scope-loading">
          {fr.setup.scopeLoading}
        </AppText>
      ) : rows.length === 0 ? (
        <AppText variant="body" tone="soft" testID="scope-empty">
          {fr.setup.scopeEmpty}
        </AppText>
      ) : (
        <>
          <ScrollView style={{ maxHeight: 380 }}>
            {/* The first choice, and the one a player already has: the whole book. */}
            <Pressable
              testID="scope-whole-book"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: picked.length === 0 }}
              accessibilityLabel={fr.setup.scopeWhole}
              accessibilityHint={fr.setup.scopeWholeHint}
              onPress={() => {
                lightFeedback();
                setPicked([]);
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space.sm,
                minHeight: theme.touch.secondary,
                paddingHorizontal: theme.space.sm,
                paddingVertical: theme.space.xs,
                marginBottom: theme.space.xs,
                borderRadius: theme.radius.field,
                borderWidth: 1,
                borderColor: picked.length === 0 ? theme.colors.brass : theme.colors.line,
                backgroundColor: pressed ? theme.colors.surfaceRaised : theme.colors.surface,
              })}
            >
              <Box checked={picked.length === 0} testID="scope-mark-whole-book" />
              <BookOpen size={18} color={theme.colors.inkSoft} />
              <AppText variant="body" weight="semibold" style={{ flex: 1 }}>
                {fr.setup.scopeWhole}
              </AppText>
              <AppText variant="small" tone="soft">
                {total}
              </AppText>
            </Pressable>

            {rows.map((row) => line(row, 0, false))}
          </ScrollView>

          <View style={{ gap: theme.space.xs, paddingTop: theme.space.sm }}>
            <AppText variant="small" tone="soft" testID="scope-count">
              {picked.length === 0 ? fr.setup.scopeNoneChosen : fr.setup.scopeChosen(picked.length, names, total)}
            </AppText>
            <PrimaryButton
              testID="scope-confirm"
              icon={Check}
              label={picked.length === 0 ? fr.setup.scopeConfirmWhole : fr.setup.scopeConfirm}
              onPress={() => onConfirm(scopeOf(picked))}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}

/** The tick box of a row. */
function Box({ checked, testID }: { checked: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: checked ? theme.colors.brass : theme.colors.inkFaint,
        backgroundColor: checked ? theme.colors.brass : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {checked ? (
        <AppText variant="micro" weight="bold" style={{ color: theme.colors.brassInk, lineHeight: 16 }}>
          ✓
        </AppText>
      ) : null}
    </View>
  );
}
