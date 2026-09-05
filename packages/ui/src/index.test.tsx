// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Input,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogAction,
  AlertDialogCancel,
  Switch,
  Checkbox,
  EmptyState,
  StatusBadge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Label
} from "./index.js";

describe("@flowdesk/ui Foundation Primitives", () => {
  it("StatusBadge preserves backwards compatibility and encodes data-status", () => {
    const { container: healthyContainer } = render(
      <StatusBadge healthy={true}>Operational</StatusBadge>
    );
    const healthyBadge = healthyContainer.querySelector('[data-status="healthy"]');
    expect(healthyBadge).toBeTruthy();
    expect(healthyBadge?.textContent).toBe("Operational");

    const { container: unavailContainer } = render(
      <StatusBadge healthy={false}>Degraded</StatusBadge>
    );
    const unavailBadge = unavailContainer.querySelector('[data-status="unavailable"]');
    expect(unavailBadge).toBeTruthy();
    expect(unavailBadge?.textContent).toBe("Degraded");
  });

  it("Button renders variants and respects disabled state", async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(
      <div>
        <Button variant="default" onClick={() => (clicked = true)}>
          Default Action
        </Button>
        <Button variant="destructive" disabled onClick={() => (clicked = true)}>
          Disabled Action
        </Button>
      </div>
    );

    const defaultBtn = screen.getByRole("button", { name: "Default Action" });
    const disabledBtn = screen.getByRole("button", { name: "Disabled Action" });

    expect((disabledBtn as HTMLButtonElement).disabled).toBe(true);
    await user.click(defaultBtn);
    expect(clicked).toBe(true);

    clicked = false;
    await user.click(disabledBtn);
    expect(clicked).toBe(false);
  });

  it("Badge supports all semantic variants", () => {
    render(
      <div>
        <Badge variant="default">Default</Badge>
        <Badge variant="secondary">Secondary</Badge>
        <Badge variant="outline">Outline</Badge>
        <Badge variant="destructive">Destructive</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="info">Info</Badge>
      </div>
    );
    expect(screen.getByText("Success")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText("Info")).toBeTruthy();
  });

  it("Input supports sensitive inputs and accessibility attributes", () => {
    render(
      <Input
        type="password"
        placeholder="API Secret Key"
        aria-label="API Secret"
        aria-invalid="true"
        aria-describedby="secret-error"
        autoComplete="new-password"
      />
    );
    const input = screen.getByPlaceholderText("API Secret Key");
    expect(input.getAttribute("type")).toBe("password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("secret-error");
    expect(input.getAttribute("autocomplete")).toBe("new-password");
  });

  it("Dialog opens and closes via trigger and accessible close", async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open Modal</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Dialog Heading</DialogTitle>
          <p>Dialog description content.</p>
        </DialogContent>
      </Dialog>
    );

    expect(screen.queryByText("Dialog Heading")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open Modal" }));
    expect(screen.getByText("Dialog Heading")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByText("Dialog Heading")).toBeNull();
    });
  });

  it("AlertDialog triggers confirmation actions", async () => {
    const user = userEvent.setup();
    let confirmed = false;
    render(
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive">Delete Integration</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => (confirmed = true)}>
            Confirm Revocation
          </AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    );

    await user.click(screen.getByRole("button", { name: "Delete Integration" }));
    expect(screen.getByText("Are you absolutely sure?")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Confirm Revocation" }));
    expect(confirmed).toBe(true);
  });

  it("Switch and Checkbox toggle state accurately", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Switch aria-label="Toggle emergency stop" />
        <Checkbox aria-label="Acknowledge policy risk" />
      </div>
    );

    const toggle = screen.getByRole("switch", { name: "Toggle emergency stop" });
    const checkbox = screen.getByRole("checkbox", { name: "Acknowledge policy risk" });

    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    await user.click(checkbox);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
  });

  it("EmptyState renders domain-neutral illustration, copy, and action slot", () => {
    render(
      <EmptyState
        title="No Channels Configured"
        description="Connect a WhatsApp Cloud API business account to start messaging."
        action={<Button>Connect Channel</Button>}
      />
    );
    expect(screen.getByText("No Channels Configured")).toBeTruthy();
    expect(
      screen.getByText("Connect a WhatsApp Cloud API business account to start messaging.")
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect Channel" })).toBeTruthy();
  });

  it("representative automated axe fixture has zero serious or critical violations (contrast excluded)", async () => {
    const { container } = render(
      <main>
        <Card>
          <CardHeader>
            <CardTitle>Security Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <Label htmlFor="token-input">Webhook Token</Label>
              <Input id="token-input" type="password" defaultValue="sec_live_123" />
              <div className="flex items-center gap-2">
                <Switch id="auto-rotate" aria-label="Auto rotate secrets" />
                <Label htmlFor="auto-rotate">Auto-rotate secrets</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="confirm-policy" aria-label="Confirm security policy" />
                <Label htmlFor="confirm-policy">Confirm security policy</Label>
              </div>
              <Tabs defaultValue="general">
                <TabsList aria-label="Settings tabs">
                  <TabsTrigger value="general">General</TabsTrigger>
                  <TabsTrigger value="advanced">Advanced</TabsTrigger>
                </TabsList>
                <TabsContent value="general">
                  <p>General configuration options.</p>
                </TabsContent>
                <TabsContent value="advanced">
                  <p>Advanced enterprise controls.</p>
                </TabsContent>
              </Tabs>
              <Button type="submit">Update Token</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );

    // Note: color-contrast is excluded from this automated jsdom axe fixture because
    // jsdom does not calculate computed styles or real font/canvas rendering.
    // Contrast requires separate/manual validation in real browser viewports.
    const results = await axe.run(container, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } }
    });
    const criticalOrSerious = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? "")
    );
    expect(criticalOrSerious).toEqual([]);
  });

  describe("Deterministic Semantic Token Contrast Verification (WCAG 2.1 AA >= 4.5:1)", () => {
    // Standard OKLCH to relative luminance (Y in CIE XYZ D65)
    function oklchToRelativeLuminance(L: number, C: number, hDeg: number): number {
      const hRad = (hDeg * Math.PI) / 180;
      const a = C * Math.cos(hRad);
      const b = C * Math.sin(hRad);

      const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
      const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
      const s_ = L - 0.0894841775 * a - 1.291485548 * b;

      const l = l_ ** 3;
      const m = m_ ** 3;
      const s = s_ ** 3;

      // CIE Y is the standard relative luminance
      return -0.0405801784232806 * l + 1.11225686961683 * m - 0.0716766786656012 * s;
    }

    function calculateContrastRatio(y1: number, y2: number): number {
      const lighter = Math.max(y1, y2);
      const darker = Math.min(y1, y2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    const lightTokens = [
      { name: "primary", bg: [0.205, 0, 0], fg: [0.985, 0, 0] },
      { name: "destructive", bg: [0.55, 0.22, 27.325], fg: [0.985, 0, 0] },
      { name: "success", bg: [0.5, 0.17, 149.214], fg: [0.985, 0, 0] },
      { name: "warning", bg: [0.769, 0.188, 70.08], fg: [0.145, 0, 0] },
      { name: "info", bg: [0.5, 0.16, 245.2], fg: [0.985, 0, 0] }
    ] as const;

    const darkTokens = [
      { name: "primary", bg: [0.985, 0, 0], fg: [0.205, 0, 0] },
      { name: "destructive", bg: [0.55, 0.22, 27.325], fg: [0.985, 0, 0] },
      { name: "success", bg: [0.5, 0.17, 149.214], fg: [0.985, 0, 0] },
      { name: "warning", bg: [0.769, 0.188, 70.08], fg: [0.145, 0, 0] },
      { name: "info", bg: [0.5, 0.16, 245.2], fg: [0.985, 0, 0] }
    ] as const;

    it("verifies all light theme semantic token pairs exceed WCAG AA 4.5:1 ratio", () => {
      for (const token of lightTokens) {
        const bgY = oklchToRelativeLuminance(token.bg[0], token.bg[1], token.bg[2]);
        const fgY = oklchToRelativeLuminance(token.fg[0], token.fg[1], token.fg[2]);
        const ratio = calculateContrastRatio(bgY, fgY);
        expect(
          ratio,
          `Light theme token "${token.name}" ratio (${ratio.toFixed(2)}:1) must be >= 4.5:1`
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it("verifies all dark theme semantic token pairs exceed WCAG AA 4.5:1 ratio", () => {
      for (const token of darkTokens) {
        const bgY = oklchToRelativeLuminance(token.bg[0], token.bg[1], token.bg[2]);
        const fgY = oklchToRelativeLuminance(token.fg[0], token.fg[1], token.fg[2]);
        const ratio = calculateContrastRatio(bgY, fgY);
        expect(
          ratio,
          `Dark theme token "${token.name}" ratio (${ratio.toFixed(2)}:1) must be >= 4.5:1`
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  });
});
