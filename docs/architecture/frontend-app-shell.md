# Frontend AppShell Architecture (UI-03)

This document describes the enterprise application shell implemented in `apps/web/src/components/layout/AppShell.tsx`, which serves as the global layout for all authenticated operations.

## Architecture

The AppShell utilizes a responsive CSS grid layout consisting of three main components:
1. **AppSidebar**: A fixed-width navigation bar on the left (desktop >= 1024px). Can be toggled between expanded (256px) and collapsed (64px) states.
2. **Header**: A top sticky bar containing contextual breadcrumbs, a global command palette trigger (Cmd+K), a theme toggle, and a mobile hamburger menu trigger.
3. **Main Content**: A scrollable area where TanStack Router renders the active route component.

On mobile viewports (< 1024px), the `AppSidebar` transforms into a Radix UI `Sheet` component that slides in from the left when triggered by the hamburger icon.

## Navigation Groups & Permissions

Navigation links are categorized into distinct semantic groups (OPERATIONS, AI, MANAGE, DEVELOPERS, SECURITY) in `apps/web/src/components/layout/navigation.ts`.

Each navigation item can optionally specify a required RBAC permission key (e.g., `audit:view`). The AppSidebar automatically filters out navigation links if the active user session lacks the required permission, ensuring a secure and clean UI.

## Component Ownership

- **Layout Structure**: `AppShell.tsx`, `AppSidebar.tsx`, `Header.tsx`, `OrgSwitcher.tsx`, `UserNav.tsx`, `CommandMenu.tsx` (all housed in `apps/web/src/components/layout/`).
- **Primitives**: `@flowdesk/ui` (`Command`, `Dialog`, `Sheet`, `DropdownMenu`, `Avatar`, `Button`, `Badge`).
- **Routing**: `apps/web/src/routes/__root.tsx` is responsible for evaluating the authentication state and wrapping the application in the `AppShell` if the user is signed in.

## Workspace / Org Switcher

The `OrgSwitcher` allows users to seamlessly switch between multiple organizations they belong to. Selecting an organization updates the application's global `selectedOrgId` and invalidates necessary queries to re-fetch context-specific data.

## Command Palette

The `CommandMenu` provides rapid keyboard-driven navigation (`Cmd+K` or `Ctrl+K`). It leverages `cmdk` for an accessible and highly responsive search experience, mirroring the available navigation routes.

## Theme Persistence

The application supports system, light, and dark modes. Theme preference is managed by `ThemeProvider` and persisted in `localStorage` under the `flowdesk-theme` key. Toggling the theme immediately updates the UI without a flash of unstyled content.

## Rollback

The AppShell layout is strictly isolated within the frontend presentation layer. If a critical regression occurs, the commit can be reverted safely without impacting backend contracts, database schemas, or individual view component business logic.
