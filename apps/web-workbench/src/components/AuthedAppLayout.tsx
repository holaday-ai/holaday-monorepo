import * as React from 'react';
import { AppSidebarRail } from '@/components/AppSidebarRail';
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar';

/**
 * Product polish #3 — wraps every authed sub-page in the persistent
 * shadcn sidebar shell so users don't lose the navigation surface
 * when they leave the workbench. Renders a slim icon-rail
 * (`AppSidebarRail`) on the left + the page content (PageShell-
 * wrapped) on the right.
 *
 * The rail defaults to collapsed (icon-only) so secondary pages
 * keep their generous reading width. Cmd/Ctrl+B expands the rail
 * for users who want labels.
 *
 * Why a separate Layout (vs reusing the workbench's Sidebar.tsx):
 * Sidebar.tsx is built around the active-task list + the workbench
 * compositor's modal stack (search overlay, feedback drawer,
 * settings dialog). On a sub-page none of those make sense — the
 * user is HERE to look at scheduled tasks / batch tasks / files,
 * not at the workbench dashboard. AppSidebarRail keeps only
 * the navigation primitives needed across the app.
 */
export function AuthedAppLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebarRail />
      <SidebarInset className="bg-background">{children}</SidebarInset>
    </SidebarProvider>
  );
}
