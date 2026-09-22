import type { ReactNode } from 'react';
import { AdminShell } from '../../components/admin-shell';

/** The admin gate for every `/graphes/**` route; the editor fills the viewport. */
export default function GraphesLayout({ children }: { children: ReactNode }) {
  return <AdminShell fill>{children}</AdminShell>;
}
