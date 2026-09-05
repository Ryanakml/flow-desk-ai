# FlowDesk Frontend Design System Specification

> **Milestone**: M6.5 — Frontend Architecture & Product UI Redesign  
> **Package**: `@flowdesk/ui`  
> **Status**: Authoritative Architectural Standard  
> **Target Stack**: React 19 + Tailwind CSS v4 + Radix UI Primitives + CVA + Lucide Icons  
> **Aesthetic Philosophy**: Linear × Attio × Intercom × Modern shadcn

---

## 1. Design Principles & Aesthetic Philosophy

FlowDesk's design system establishes a high-density, restrained operational cockpit for customer operations, WhatsApp automations, and developer tooling:

1. **Restrained Enterprise Neutrality**:
   - Eliminates heavy prototype glassmorphism (`--shadow-glass`, blur filters), dark radial glows, and high-saturation neon accents.
   - Adopts neutral base surfaces, subtle 1px border dividers (`border-border`), and calm typography contrast.
2. **High Information Density**:
   - Compact table paddings (`h-10` headers, `p-2` cells), 36px standard button and input heights, and tight card headers to optimize screen real-estate for operators managing hundreds of concurrent WhatsApp threads.
3. **Accessibility First (WCAG 2.1 AA Target)**:
   - Radix UI accessible foundation guaranteeing focus management, Escape-key dismissal, screen-reader semantics, and visible keyboard rings (`focus-visible:ring-1 focus-visible:ring-ring`).
4. **Strict Light & Dark Mode Parity**:
   - Design tokens map symmetrically across light and dark modes via semantic CSS variables using standard OKLCH palettes.

---

## 2. Component Ownership & Monorepo Boundaries

To maintain clean separation of concerns and avoid competing UI directories across the monorepo, strict ownership rules are enforced:

| Layer                        | Location                                     | Purpose & Dependencies                                                                                                                                                 |
| :--------------------------- | :------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Universal Primitives**     | `packages/ui`                                | 100% domain-neutral presentation components (Button, Dialog, Card, Input, etc.). **Zero dependencies** on FlowDesk business logic, API clients, or database contracts. |
| **Application Composite UI** | `apps/web/src/components`                    | App-wide cross-cutting layouts and composites (Theme toggles, navigation shells, toast providers).                                                                     |
| **Feature / Domain UI**      | `apps/web/src/features/<feature>/components` | Domain-specific surfaces (e.g. `AiDraftCard`, `ConversationTimeline`, `WebhookDeliveryDrawer`, `ChannelConfigSheet`).                                                  |

> **Strict Rule**: Do NOT create competing `apps/web/src/components/ui/*` directories. All shadcn-style primitives must live in `packages/ui`.

---

## 3. Design Token Architecture

Tokens are authored as semantic CSS variables in `packages/ui/src/styles/tokens.css` and bound directly into Tailwind CSS v4 using `@theme inline`.

### Token Families

- **Surfaces**: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--popover-foreground`.
- **Brand / Neutral**: `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`.
- **Semantic Feedback**: `--destructive`, `--destructive-foreground`, `--success`, `--success-foreground`, `--warning`, `--warning-foreground`, `--info`, `--info-foreground` (all calibrated to satisfy WCAG 2.1 AA >= 4.5:1 normal text contrast against their respective foregrounds).
- **Input & Elevation**: `--border`, `--input`, `--ring`, `--fd-radius-sm` (6px), `--fd-radius-md` (8px), `--fd-radius-lg` (12px), `--fd-radius` (8px). Distinct source custom property names (`--fd-radius-*`) avoid self-referential cyclic resolution when mapped to Tailwind's `--radius-*` theme declarations.

### Light / Dark Theme Modes

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --border: oklch(0.922 0 0);
  /* ... */
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.145 0 0);
  --border: oklch(0.269 0 0);
  /* ... */
}
```

Theme switching applies the `.dark` class on the root `<html>` element. Non-sensitive theme preferences are persisted in `localStorage`.

---

## 4. Primitive Inventory (`packages/ui`)

All 17 required universal primitives are implemented in `packages/ui`:

1. **Button**: Radix `Slot` integration with CVA variants (`default`, `secondary`, `destructive`, `outline`, `ghost`, `link`) and sizes (`sm`, `default`, `lg`, `icon`).
2. **Badge**: Semantic variants (`default`, `secondary`, `outline`, `destructive`, `success`, `warning`, `info`).
3. **Card**: Modular container (`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`).
4. **Dialog**: Accessible modal dialog (`Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`).
5. **AlertDialog**: Destructive confirmation modal (`AlertDialog`, `AlertDialogTrigger`, `AlertDialogContent`, `AlertDialogAction`, `AlertDialogCancel`, etc.).
6. **DropdownMenu**: Contextual popup (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, etc.).
7. **Popover**: Floating content container (`Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor`).
8. **Form Primitives**:
   - `Label`: Accessible form label bound with `htmlFor`.
   - `Input`: Text/Password input supporting `aria-invalid`, `aria-describedby`, and password masking.
   - `Textarea`: Multi-line text input.
   - `Select`: Radix select dropdown with scroll buttons.
   - `Checkbox`: Accessible checkbox with check indicator.
   - `Switch`: Toggle switch with sliding thumb.
9. **Table**: Semantic data grid (`Table`, `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`).
10. **Tooltip**: Accessible hover tooltip with `TooltipProvider`.
11. **Sheet**: Slide-out drawer panel (`Sheet`, `SheetTrigger`, `SheetContent` with `side="top"|"bottom"|"left"|"right"`).
12. **Separator**: Horizontal and vertical layout divider.
13. **ScrollArea**: Custom scroll container with horizontal/vertical scrollbars.
14. **Tabs**: Segmented tab controls (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`).
15. **Breadcrumb**: Hierarchical page trail (`Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator`).
16. **Skeleton**: Content loading pulse placeholder.
17. **EmptyState**: Universal composite container featuring an icon slot, title, description, and optional call-to-action slot.

---

## 5. Backwards Compatibility: `StatusBadge`

The legacy export `StatusBadge` in `@flowdesk/ui` is preserved with 100% API compatibility:

```tsx
import { StatusBadge } from "@flowdesk/ui";

// Works identically to pre-redesign callers:
<StatusBadge healthy={true}>Operational</StatusBadge>
<StatusBadge healthy={false}>Degraded</StatusBadge>
```

Internally, `StatusBadge` delegates to the modernized `Badge` with semantic `variant="success"` or `variant="destructive"` while rendering `data-status="healthy"` or `data-status="unavailable"` for existing test suites.

---

## 6. Icon Conventions (`lucide-react`)

`lucide-react` is established as the sole authoritative icon system across FlowDesk:

- **Consistent Sizing**:
  - `size-4` (16px) for inline button icons and badges.
  - `size-5` (20px) for navigation tabs and cards.
  - `size-6` (24px) for empty state illustrations.
- **Accessibility**: Icon-only buttons must provide an explicit accessible label via `aria-label="Action Description"` or an inner `<span className="sr-only">`.
- **Legacy SVGs**: Existing inline SVG icons remain in legacy views until their respective milestone surface redesign (UI-04 through UI-09).

---

## 7. Sensitive Input Handling & Secrets Security

Input primitives strictly adhere to the security rules defined in the M6.5 Migration Contract:

- Sensitive inputs (API keys, webhook secrets, channel tokens) must use `type="password"`, `autoComplete="new-password"` or `off`, and `aria-describedby` pointing to helper text.
- Never write raw secrets to localStorage, console logs, or analytics telemetry.
- Secret reveal dialogues must use `Dialog` or `AlertDialog` with one-time copy actions.

---

## 8. Visual Evidence & Showcase Harness

A non-production development showcase harness is provided at `apps/web/src/DesignSystemShowcase.tsx`.
To guarantee production safety:

- In `apps/web/src/main.tsx`, the showcase is gated by `import.meta.env.DEV && new URLSearchParams(window.location.search).get("showcase") === "true"`.
- In production builds (`import.meta.env.DEV === false`), `App.tsx` is **always** rendered unconditionally, and `?showcase=true` has zero effect.
- `App.tsx` contains no showcase-specific branching or conditional returns before hooks.

Captured visual evidence:

- **Light Mode Benchmark**: [`docs/architecture/design-system-evidence/design-system-light.png`](design-system-evidence/design-system-light.png)
- **Dark Mode Benchmark**: [`docs/architecture/design-system-evidence/design-system-dark.png`](design-system-evidence/design-system-dark.png)

---

## 9. Accessibility Verification & Evidence

FlowDesk primitives are engineered with an accessibility-first posture, with evidence scoped accurately:

- **Automated Fixture Scan**: The automated test suite (`packages/ui/src/index.test.tsx`) runs `axe-core` against a representative interactive fixture (containing Card, Label, Input, Switch, Checkbox, Tabs, and Button). The fixture has **zero serious or critical automated violations**.
- **Contrast Verification (Deterministic Calculation)**:
  Color-contrast verification is explicitly excluded (`rules: { "color-contrast": { enabled: false } }`) from the automated jsdom `axe-core` run because jsdom cannot compute styled render geometries or font rendering.
  Instead, **deterministic relative luminance and contrast ratio calculations** (per WCAG 2.1 CIE Y relative luminance algorithm) are executed as dedicated unit tests in `packages/ui/src/index.test.tsx`:
  - `primary` (light & dark): **17.16:1** (target >= 4.5:1)
  - `destructive` (light & dark): **5.20:1** (target >= 4.5:1)
  - `success` (light & dark): **5.33:1** (target >= 4.5:1)
  - `warning` (light & dark): **9.17:1** (target >= 4.5:1)
  - `info` (light & dark): **5.72:1** (target >= 4.5:1)
    Every semantic token pair mathematically exceeds WCAG 2.1 AA (4.5:1) for normal text across both light and dark modes.
- **Keyboard & Focus Handling**: Underlying primitives leverage Radix UI to enforce accessible keyboard navigation (`Tab`, `Arrow` keys), focus retention/trapping within modals, and `Escape` key dismissal. Focused interaction tests verify keyboard and attribute semantics.
- **M6.5 Milestone Scope**: Full comprehensive WCAG 2.1 AA acceptance testing across all composite views and color pairings will be conducted during later M6.5 milestone acceptance work (UI-11 / UI-12), rather than claiming universal compliance at the primitive foundation phase.

---

## 10. How to Add a New Shared Primitive

1. Verify that the candidate primitive is **strictly domain-neutral** (no WhatsApp, billing, or FlowDesk entity logic).
2. Install the underlying Radix UI primitive in `packages/ui` if applicable (`pnpm add @radix-ui/react-<primitive> --filter @flowdesk/ui`).
3. Author the component in `packages/ui/src/components/<name>.tsx` using CVA and `cn()`.
4. Export the component from `packages/ui/src/index.tsx`.
5. Add unit and accessibility tests in `packages/ui/src/index.test.tsx` verifying render, interaction, and automated `axe-core` clean status.
6. Verify monorepo build and linting: `pnpm --filter @flowdesk/ui test && pnpm --filter @flowdesk/ui build`.

### What NOT to Put in `packages/ui`

- Do NOT put business logic, API calls (`api.ts`), or React Query hooks in `packages/ui`.
- Do NOT put FlowDesk domain models (Conversations, Messages, AuditLogs, Policies) in `packages/ui`.
- Do NOT put page layouts or routing components in `packages/ui`.
