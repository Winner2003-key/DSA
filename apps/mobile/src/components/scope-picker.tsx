import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from './app-text';
import { LinkButton, PrimaryButton } from './buttons';
import { Sheet } from './sheet';
import { fr } from '@/i18n/fr';
import { lightFeedback } from '@/lib/haptics';
import type { BookSection } from '@/services/types';
import { useTheme } from '@/theme';
import { Check } from './icon';

export interface ScopePickerProps {
  visible: boolean;
  sections: BookSection[];
  /** The section ids ticked when the sheet opens. */
  value: string[];
  onClose: () => void;
  onConfirm: (scope: string[]) => void;
  loading?: boolean;
}

interface TreeNode extends BookSection {
  children: TreeNode[];
}

/**
 * Builds the picker's tree from the flat `dsa_list_sections` rows. The root
 * (START, the whole book) is dropped: choosing everything is « Tout le livre »,
 * which is the empty scope, not a ticked box.
 */
export function buildTree(sections: BookSection[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const section of sections) byId.set(section.node_id, { ...section, children: [] });

  const roots: TreeNode[] = [];
  for (const section of sections) {
    const node = byId.get(section.node_id) as TreeNode;
    const parent = section.parent_id === null ? undefined : byId.get(section.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  // Skip the START node itself and offer its children as the top level.
  return roots.flatMap((root) => (root.depth === 0 ? root.children : [root]));
}

/** Every section id at or under `node`. */
function subtreeIds(node: TreeNode): string[] {
  return [node.node_id, ...node.children.flatMap(subtreeIds)];
}

/**
 * « Choisir une partie » — the book's sections as a compact tree, with the number
 * of names on each and a "tout cocher" on any branch. It shows labels and counts
 * only: no name, no clue, nothing a player couldn't read in the table of contents.
 */
export function ScopePicker({ visible, sections, value, onClose, onConfirm, loading = false }: ScopePickerProps) {
  const theme = useTheme();
  const tree = useMemo(() => buildTree(sections), [sections]);
  const [picked, setPicked] = useState<string[]>(value);
  const [open, setOpen] = useState<string[]>([]);

  // Re-open on the current choice, not on whatever was picked last time.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setPicked(value);
  }

  const chosen = new Set(picked);
  const total = useMemo(
    () => tree.reduce((sum, node) => sum + node.characters, 0),
    [tree],
  );
  const names = useMemo(() => {
    // A parent and its child can both be ticked; count each name once.
    const counted = new Set<string>();
    let sum = 0;
    const walk = (node: TreeNode, insideChosen: boolean) => {
      const inside = insideChosen || chosen.has(node.node_id);
      if (inside && !insideChosen && !counted.has(node.node_id)) {
        counted.add(node.node_id);
        sum += node.characters;
      }
      for (const child of node.children) walk(child, inside);
    };
    for (const node of tree) walk(node, false);
    return sum;
  }, [picked, tree]);

  const toggle = (node: TreeNode) => {
    lightFeedback();
    setPicked((current) => {
      const set = new Set(current);
      if (set.has(node.node_id)) set.delete(node.node_id);
      else {
        set.add(node.node_id);
        // A branch covers its children, so ticking it clears them.
        for (const id of subtreeIds(node)) if (id !== node.node_id) set.delete(id);
      }
      return [...set];
    });
  };

  const tickAll = (node: TreeNode) => {
    lightFeedback();
    setPicked((current) => {
      const set = new Set(current);
      for (const id of subtreeIds(node)) set.delete(id);
      for (const child of node.children) set.add(child.node_id);
      return [...set];
    });
  };

  const row = (node: TreeNode, insideChosen: boolean): React.ReactNode => {
    const isChosen = chosen.has(node.node_id);
    const covered = insideChosen || isChosen;
    const expanded = open.includes(node.node_id);
    const hasChildren = node.children.length > 0;
    return (
      <View key={node.node_id}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space.xs,
            paddingLeft: Math.min(node.depth - 1, 4) * theme.space.md,
          }}
        >
          <Pressable
            testID={`scope-row-${node.node_id}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: covered, disabled: insideChosen }}
            accessibilityLabel={node.label}
            accessibilityHint={fr.setup.scopeNames(node.characters)}
            disabled={insideChosen}
            onPress={() => toggle(node)}
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
            <View
              testID={`scope-mark-${node.node_id}`}
              style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: covered ? theme.colors.brass : theme.colors.inkFaint,
                backgroundColor: covered ? theme.colors.brass : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {covered ? (
                <AppText variant="micro" weight="bold" style={{ color: theme.colors.brassInk, lineHeight: 16 }}>
                  ✓
                </AppText>
              ) : null}
            </View>
            <AppText variant="body" weight={node.depth === 1 ? 'semibold' : 'regular'} style={{ flex: 1 }}>
              {node.label}
            </AppText>
            <AppText variant="small" tone="soft">
              {node.characters}
            </AppText>
          </Pressable>

          {hasChildren ? (
            <Pressable
              testID={`scope-open-${node.node_id}`}
              accessibilityRole="button"
              accessibilityLabel={expanded ? fr.setup.scopeCollapse(node.label) : fr.setup.scopeExpand(node.label)}
              onPress={() =>
                setOpen((current) =>
                  current.includes(node.node_id)
                    ? current.filter((id) => id !== node.node_id)
                    : [...current, node.node_id],
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
          <View>
            {!covered ? (
              <View style={{ paddingLeft: Math.min(node.depth, 4) * theme.space.md + theme.space.sm }}>
                <LinkButton
                  testID={`scope-all-${node.node_id}`}
                  label={fr.setup.scopeTickAll}
                  onPress={() => tickAll(node)}
                />
              </View>
            ) : null}
            {node.children.map((child) => row(child, covered))}
          </View>
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
      ) : tree.length === 0 ? (
        <AppText variant="body" tone="soft" testID="scope-empty">
          {fr.setup.scopeEmpty}
        </AppText>
      ) : (
        <>
          <ScrollView style={{ maxHeight: 380 }}>{tree.map((node) => row(node, false))}</ScrollView>
          <View style={{ gap: theme.space.xs, paddingTop: theme.space.sm }}>
            <AppText variant="small" tone="soft" testID="scope-count">
              {picked.length === 0 ? fr.setup.scopeNoneChosen : fr.setup.scopeChosen(picked.length, names, total)}
            </AppText>
            <PrimaryButton
              testID="scope-confirm"
              icon={Check}
              label={fr.setup.scopeConfirm}
              disabled={picked.length === 0 || names === 0}
              onPress={() => onConfirm(picked)}
            />
            <LinkButton testID="scope-whole-book" label={fr.setup.scopeWholeBook} onPress={() => onConfirm([])} />
          </View>
        </>
      )}
    </Sheet>
  );
}
