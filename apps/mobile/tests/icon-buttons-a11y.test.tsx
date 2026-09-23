import React from 'react';
import { within } from '@testing-library/react-native';

import { renderWithProviders } from './helpers';
import AccueilScreen from '../app/index';
import PreparerScreen from '../app/jouer/index';
import { IconButton, Settings, TopBar } from '@/components';
import { fr } from '@/i18n/fr';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const PRESSABLE_ROLES = ['button', 'switch', 'checkbox', 'radio'] as const;

type Screen = Awaited<ReturnType<typeof renderWithProviders>>;

/** Every control a player can press says what it does, in words, even when it shows only an icon. */
function unlabelledControls(screen: Screen): string[] {
  return PRESSABLE_ROLES.flatMap((role) => screen.queryAllByRole(role))
    .filter((node) => !node.props.accessibilityLabel && within(node).queryAllByText(/\S/).length === 0)
    .map((node) => String(node.props.testID ?? node.props.accessibilityRole));
}

describe('icon-only controls', () => {
  it('the Accueil has no unlabelled control', async () => {
    const screen = await renderWithProviders(<AccueilScreen />);
    expect(unlabelledControls(screen)).toEqual([]);
  });

  it('the setup screen has no unlabelled control', async () => {
    const screen = await renderWithProviders(<PreparerScreen />);
    expect(unlabelledControls(screen)).toEqual([]);
  });

  it('the top bar and an icon button carry their label', async () => {
    const screen = await renderWithProviders(
      <>
        <TopBar onBack={() => undefined} backLabel={fr.app.home} />
        <IconButton testID="gear" icon={Settings} accessibilityLabel="Réglages" onPress={() => undefined} />
      </>,
    );
    expect(screen.getByLabelText(fr.app.home)).toBeTruthy();
    expect(screen.getByTestId('gear').props.accessibilityLabel).toBe('Réglages');
    expect(unlabelledControls(screen)).toEqual([]);
  });

  it('the check fails on a pressable icon with no label', async () => {
    const screen = await renderWithProviders(
      // @ts-expect-error — the type already forbids it; the runtime check must catch it too.
      <IconButton testID="bare" icon={Settings} onPress={() => undefined} />,
    );
    expect(unlabelledControls(screen)).toContain('bare');
  });
});
