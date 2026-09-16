import type { Metadata } from 'next';
import { Archivo, Newsreader } from 'next/font/google';
import './globals.css';

/** The tool's voice: a grotesque with real French diacritics and tabular figures. */
const archivo = Archivo({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-archivo',
  display: 'swap',
});

/** The book's voice: every string transcribed from the book is set in this. */
const newsreader = Newsreader({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  variable: '--font-newsreader',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DSA — Administration',
  description: 'Éditeur de graphe et revue d’import pour Découverte Sans Alphabet.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${archivo.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
