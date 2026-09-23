import React from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

import { AppText } from './app-text';
import { lightFeedback } from '@/lib/haptics';
import { useTheme } from '@/theme';

export type { LucideIcon } from 'lucide-react-native';
export {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  ChevronRight,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  Flag,
  Hand,
  House,
  Keyboard,
  Lock,
  LogIn,
  Mic,
  Monitor,
  Moon,
  Play,
  QrCode,
  RefreshCw,
  Repeat,
  RotateCcw,
  Route,
  Search,
  Send,
  Settings,
  Share2,
  SkipBack,
  SkipForward,
  Sparkles,
  Sun,
  Undo2,
  UserPen,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
  BookOpen,
} from 'lucide-react-native';

/** One stroke weight for every icon, so they read as one set. */
export const ICON_STROKE = 1.8;

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: an icon alone says nothing to a screen reader. */
  accessibilityLabel: string;
  onPress: () => void;
  /** A small word under the icon, for the icons whose meaning is not obvious. */
  label?: string;
  disabled?: boolean;
  /** Filled with the action colour: the one icon that is the screen's main action. */
  filled?: boolean;
  /** Draws the icon in the action colour, e.g. the sound toggle while it is on. */
  active?: boolean;
  testID?: string;
  style?: ViewStyle;
  accessibilityRole?: 'button' | 'switch';
  accessibilityState?: { checked?: boolean; disabled?: boolean };
}

/** A square icon button with a 56 pt target, a hitSlop, and an optional caption. */
export function IconButton({
  icon: Icon,
  accessibilityLabel,
  onPress,
  label,
  disabled = false,
  filled = false,
  active = false,
  testID,
  style,
  accessibilityRole = 'button',
  accessibilityState,
}: IconButtonProps) {
  const theme = useTheme();
  const color = filled ? theme.colors.brassInk : active ? theme.colors.brass : theme.colors.inkSoft;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...accessibilityState }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        lightFeedback();
        onPress();
      }}
      style={({ pressed }) => [
        { alignItems: 'center', gap: 2, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: theme.radius.slab,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? theme.colors.brass : theme.colors.surfaceRaised,
          borderWidth: filled ? 0 : 1,
          borderColor: active ? theme.colors.brass : theme.colors.line,
        }}
      >
        <Icon size={22} color={color} strokeWidth={ICON_STROKE} />
      </View>
      {label ? (
        <AppText variant="micro" tone="soft" weight="medium" numberOfLines={1}>
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** The rounded tinted square that holds an icon inside a card, as on the setup screen. */
export function IconTile({ icon: Icon, selected = false, tone = 'brass' }: { icon: LucideIcon; selected?: boolean; tone?: 'brass' | 'accent' }) {
  const theme = useTheme();
  const ink = tone === 'accent' ? theme.colors.accent : theme.colors.brass;
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? (tone === 'accent' ? theme.colors.accentSoft : theme.colors.brassSoft) : theme.colors.surface,
      }}
    >
      <Icon size={20} color={selected ? ink : theme.colors.inkSoft} strokeWidth={ICON_STROKE} />
    </View>
  );
}
