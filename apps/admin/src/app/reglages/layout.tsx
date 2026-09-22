import type { ReactNode } from 'react';
import { AdminShell } from '../../components/admin-shell';

/** Same gate as the graph pages; this one scrolls like an ordinary page. */
export default function ReglagesLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
