import React, { useMemo, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { bookOutline } from '@dsa/core';
import type { OutlineSection, Section } from '@dsa/core';

import { AppText } from './app-text';
import { LinkButton, PrimaryButton } from './buttons';
import { Screen } from './screen';
import { TopBar } from './chrome';
import { fr } from '@/i18n/fr';
import { lightFeedback } from '@/lib/haptics';
import type { BookSection } from '@/services/types';
import { useTheme } from '@/theme';
import { BookOpen, Check, ChevronRight } from './icon';

export interface ScopePickerProps {
  visible: boolean;
  sections: BookSection[];
  /** The section ids chosen when the page opens. */
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
    // A server that predates 0012 sends neither: the root is still the root,
    // and the rest is shown as it comes (no outline, but never the START node).
    nodeType: row.node_type ?? (row.parent_id === null ? 'START' : 'CATEGORY'),
    answerLabel: row.answer_label ?? null,
  }));
}

/**
 * The book's outline, as the picker walks it: ANCIEN and NOUVEAU, each with its
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

/**
 * « Choisir la partie du livre » — a page per level of the book, walked the way
 * the book is read: the two testaments, then the hommes and the femmes, then the
 * lists (PENTATEUQUE, LES 3 PREMIERS, LIVRE DE SAMUEL…), then what is inside
 * them. Touching a part opens it; the button at the bottom takes the part that
 * is open, and « Tout le livre » is always one touch away.
 *
 * It shows labels and counts only: no name, no clue, nothing a player couldn't
 * read in the sommaire.
 */
export function ScopePicker({ visible, sections, value, onClose, onConfirm, loading = false }: ScopePickerProps) {
  const theme = useTheme();
  const rows = useMemo(() => pickerRows(sections), [sections]);
  /** Where we are in the book: the keys of the parts opened, deepest last. */
  const [trail, setTrail] = useState<string[]>([]);

  // Every opening starts at the top of the book, on the choice in force.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible && trail.length > 0) setTrail([]);
  }

  const path: OutlineSection[] = [];
  let level: readonly OutlineSection[] = rows;
  for (const key of trail) {
    const found = level.find((row) => row.key === key);
    if (!found) break;
    path.push(found);
    level = found.children;
  }
  const current = path.length > 0 ? (path[path.length - 1] as OutlineSection) : null;
  const here = current ? current.children : rows;
  const chosen = useMemo(() => new Set(pickedFrom(rows, value)), [rows, value]);

  const open = (row: OutlineSection) => {
    lightFeedback();
    setTrail((currentTrail) => [...currentTrail, row.key]);
  };
  const back = () => {
    if (trail.length === 0) {
      onClose();
      return;
    }
    lightFeedback();
    setTrail((currentTrail) => currentTrail.slice(0, -1));
  };

  const part = (row: OutlineSection) => {
    const hasChildren = row.children.length > 0;
    const isChosen = chosen.has(row.key);
    return (
      <Pressable
        key={row.key}
        testID={`scope-row-${row.key}`}
        accessibilityRole="button"
        accessibilityLabel={hasChildren ? fr.setup.scopeExpand(row.label) : row.label}
        accessibilityHint={
          hasChildren ? fr.setup.scopeNamesAndParts(row.characters, row.children.length) : fr.setup.scopeNames(row.characters)
        }
        onPress={() => (hasChildren ? open(row) : onConfirm(row.nodeIds))}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space.sm,
          minHeight: theme.touch.secondary,
          paddingHorizontal: theme.space.md,
          paddingVertical: theme.space.sm,
          borderRadius: theme.radius.slab,
          borderWidth: 1,
          borderColor: isChosen ? theme.colors.brass : theme.colors.line,
          backgroundColor: pressed ? theme.colors.surface : theme.colors.surfaceRaised,
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="body" weight="semibold">
            {row.label}
          </AppText>
          <AppText variant="micro" tone="soft">
            {hasChildren
              ? fr.setup.scopeNamesAndParts(row.characters, row.children.length)
              : fr.setup.scopeNames(row.characters)}
          </AppText>
        </View>
        {isChosen ? <Check size={18} color={theme.colors.brass} /> : null}
        {hasChildren ? <ChevronRight size={20} color={theme.colors.inkFaint} /> : null}
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={back}>
      <Screen
        scroll
        testID="scope-picker"
        footer={
          loading ? null : (
            <View style={{ gap: theme.space.xs }}>
              {current ? (
                <>
                  <PrimaryButton
                    testID="scope-confirm"
                    icon={Check}
                    label={fr.setup.scopeConfirmPart(current.label)}
                    hint={fr.setup.scopeNames(current.characters)}
                    onPress={() => onConfirm(current.nodeIds)}
                  />
                  <LinkButton testID="scope-whole-book" label={fr.setup.scopeWhole} onPress={() => onConfirm([])} />
                </>
              ) : (
                <PrimaryButton
                  testID="scope-whole-book"
                  icon={BookOpen}
                  label={fr.setup.scopeConfirmWhole}
                  hint={fr.setup.scopeWholeHint}
                  onPress={() => onConfirm([])}
                />
              )}
            </View>
          )
        }
      >
        <TopBar onBack={back} backLabel={trail.length === 0 ? fr.app.close : fr.app.back} />

        <View style={{ gap: theme.space.md, paddingBottom: theme.space.lg }}>
          <View style={{ gap: theme.space.xs }}>
            {path.length > 0 ? (
              <AppText variant="small" weight="semibold" tone="brass" testID="scope-breadcrumb">
                {path.map((row) => row.label).join(' › ')}
              </AppText>
            ) : null}
            <AppText variant="display" weight="medium" tight testID="scope-heading">
              {current ? current.label : fr.setup.scopeTitle}
            </AppText>
            <AppText variant="small" tone="soft">
              {current ? fr.setup.scopeDrillHint : fr.setup.scopeHint}
            </AppText>
          </View>

          {loading ? (
            <AppText variant="body" tone="soft" testID="scope-loading">
              {fr.setup.scopeLoading}
            </AppText>
          ) : here.length === 0 ? (
            <AppText variant="body" tone="soft" testID="scope-empty">
              {fr.setup.scopeEmpty}
            </AppText>
          ) : (
            <View style={{ gap: theme.space.xs }}>{here.map(part)}</View>
          )}
        </View>
      </Screen>
    </Modal>
  );
}
