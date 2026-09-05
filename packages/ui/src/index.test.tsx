// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
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
  StatusBadge
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

  it("has zero serious or critical axe-core automated accessibility violations", async () => {
    const { container } = render(
      <main>
        <Card>
          <CardHeader>
            <CardTitle>Security Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4">
              <label htmlFor="token-input">Webhook Token</label>
              <Input id="token-input" type="password" defaultValue="sec_live_123" />
              <Button type="submit">Update Token</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );

    const results = await axe.run(container, {
      resultTypes: ["violations"],
      rules: { "color-contrast": { enabled: false } }
    });
    const criticalOrSerious = results.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? "")
    );
    expect(criticalOrSerious).toEqual([]);
  });
});
