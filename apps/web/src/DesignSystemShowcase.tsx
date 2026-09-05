import * as React from "react";
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Label,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
  Switch,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  Separator,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Skeleton,
  EmptyState,
  StatusBadge
} from "@flowdesk/ui";
import { Inbox, ShieldCheck, Webhook, Sun, Moon } from "lucide-react";

export function DesignSystemShowcase() {
  const [theme, setTheme] = React.useState<"light" | "dark">("light");

  React.useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground p-8 space-y-10">
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="#">FlowDesk M6.5</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>UI-01 Design System Showcase</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <h1 className="text-2xl font-bold tracking-tight mt-2">
              Shared Design System Foundation
            </h1>
            <p className="text-sm text-muted-foreground">
              Universal presentation primitives with zero FlowDesk domain/business dependencies.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              id="theme-toggle-btn"
              variant="outline"
              size="sm"
              onClick={toggleTheme}
              className="gap-2"
            >
              {theme === "light" ? <Moon className="size-4" /> : <Sun className="size-4" />}
              {theme === "light" ? "Dark Mode" : "Light Mode"}
            </Button>
            <StatusBadge healthy={true}>StatusBadge: Operational</StatusBadge>
          </div>
        </div>

        {/* Section 1: Buttons & Badges */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Button Variants & Sizes</CardTitle>
              <CardDescription>
                Radix slot-capable buttons with CVA variants conforming to Linear/Attio restrained
                aesthetic.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button variant="default">Default</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
                <Button size="icon" aria-label="Inbox Icon">
                  <Inbox className="size-4" />
                </Button>
                <Button disabled>Disabled</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Badge Variants</CardTitle>
              <CardDescription>Semantic status indicators and entity tags.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">Primary</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="outline">Outline</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="warning">Warning</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="info">Info</Badge>
              </div>
              <Separator />
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium">Backwards Compatibility:</span>
                <StatusBadge healthy={true}>Legacy Healthy</StatusBadge>
                <StatusBadge healthy={false}>Legacy Unavailable</StatusBadge>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Section 2: Form Controls & Inputs */}
        <Card>
          <CardHeader>
            <CardTitle>Form Primitives & Sensitive Input Handling</CardTitle>
            <CardDescription>
              Input, Textarea, Select, Checkbox, Switch, and Label with ARIA validation support.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="api-key-input">API Key Secret (Sensitive Input)</Label>
              <Input
                id="api-key-input"
                type="password"
                defaultValue="fd_live_mock_secret_key_1234"
                autoComplete="new-password"
                aria-describedby="api-key-desc"
              />
              <p id="api-key-desc" className="text-xs text-muted-foreground">
                Sensitive keys support masking, password type, and validation rings.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="webhook-url">Webhook Endpoint URL</Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://api.acme.example/webhook"
                defaultValue="https://api.acme.example/webhook"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="channel-type">Channel Type Selector</Label>
              <Select defaultValue="whatsapp">
                <SelectTrigger id="channel-type">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp Cloud API</SelectItem>
                  <SelectItem value="telegram">Telegram Bot API</SelectItem>
                  <SelectItem value="email">SMTP / Inbound Email</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="system-prompt">Routing Policy Note</Label>
              <Textarea
                id="system-prompt"
                placeholder="Describe the automated triage rule logic..."
                defaultValue="Route all billing refund intents with high confidence to Human Tier 2 Queue."
              />
            </div>

            <div className="space-y-4 pt-4">
              <div className="flex items-center space-x-2">
                <Checkbox id="terms" defaultChecked />
                <Label htmlFor="terms">Enable strict HMAC payload signing</Label>
              </div>
              <div className="flex items-center space-x-2">
                <Switch id="emergency-stop" />
                <Label htmlFor="emergency-stop">Emergency AI Killswitch</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Overlays & Interactive Menus */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Dialog & Alert Dialog</CardTitle>
              <CardDescription>
                Modal overlays with strict focus traps and Esc-dismiss.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Open Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Configure API Key Scope</DialogTitle>
                    <DialogDescription>
                      Assign fine-grained access control permissions for programmatic tokens.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox id="scope-read" defaultChecked />
                      <Label htmlFor="scope-read">conversation:read</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="scope-write" defaultChecked />
                      <Label htmlFor="scope-write">message:write</Label>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Revoke Key</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action will immediately invalidate the API key. External clients will
                      receive 401 Unauthorized errors.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="flex justify-end gap-2 mt-4">
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction>Revoke Access</AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dropdown & Popover</CardTitle>
              <CardDescription>Accessible floating popups and contextual menus.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">Actions Menu</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Integration Actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>Rotate Secret</DropdownMenuItem>
                  <DropdownMenuItem>Test Webhook Delivery</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive">Delete Webhook</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="secondary">Info Popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <h4 className="font-semibold text-sm">Realtime Projection System</h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    Synchronized over Socket.IO using monotonic version hints and client reconcile
                    cycles.
                  </p>
                </PopoverContent>
              </Popover>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Security Info">
                    <ShieldCheck className="size-4 text-success" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>AES-256 GCM encrypted at rest</TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sheet & Navigation</CardTitle>
              <CardDescription>Sliding side panels for deep context and settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="outline" className="w-full">
                    Open Context Drawer
                  </Button>
                </SheetTrigger>
                <SheetContent side="right">
                  <SheetHeader>
                    <SheetTitle>Conversation Inspector</SheetTitle>
                    <SheetDescription>
                      Metadata, customer attributes, and RAG document citations.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="py-6 space-y-4">
                    <div className="text-sm">
                      <span className="font-semibold">Customer:</span> Budi Santoso
                    </div>
                    <div className="text-sm">
                      <span className="font-semibold">Channel:</span> Primary WhatsApp Support
                    </div>
                    <Separator />
                    <Skeleton className="h-20 w-full" />
                  </div>
                </SheetContent>
              </Sheet>
            </CardContent>
          </Card>
        </div>

        {/* Section 4: Data Tables & Tabs */}
        <Card>
          <CardHeader>
            <CardTitle>Table & Tab Primitives</CardTitle>
            <CardDescription>
              Clean enterprise data grids and segment controls without visual clutter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs defaultValue="keys">
              <TabsList>
                <TabsTrigger value="keys">API Keys</TabsTrigger>
                <TabsTrigger value="webhooks">Outbound Webhooks</TabsTrigger>
              </TabsList>
              <TabsContent value="keys" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Key Name</TableHead>
                      <TableHead>Prefix</TableHead>
                      <TableHead>Scopes</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">Zapier Ingest Key</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">fd_live_9a7f</code>
                      </TableCell>
                      <TableCell>conversation:read, message:write</TableCell>
                      <TableCell>
                        <Badge variant="success">Active</Badge>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">Legacy Migration Key</TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">fd_live_1b2c</code>
                      </TableCell>
                      <TableCell>conversation:read</TableCell>
                      <TableCell>
                        <Badge variant="destructive">Revoked</Badge>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TabsContent>
              <TabsContent value="webhooks" className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Target URL</TableHead>
                      <TableHead>Subscribed Events</TableHead>
                      <TableHead>Verification</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium">https://api.acme.example/events</TableCell>
                      <TableCell>conversation.created, message.received</TableCell>
                      <TableCell>
                        <Badge variant="success">Verified</Badge>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Section 5: Universal EmptyState & Skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Domain-Neutral EmptyState</CardTitle>
              <CardDescription>
                Reusable zero-data container with icon, copy, and action.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmptyState
                icon={<Webhook className="size-6" />}
                title="No Webhook Subscriptions"
                description="Subscribe your backend endpoints to receive real-time webhook events signed with HMAC-SHA256."
                action={<Button size="sm">Create Webhook</Button>}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Skeleton Placeholders</CardTitle>
              <CardDescription>Accessible loading state pulses.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-4">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-[250px]" />
                  <Skeleton className="h-4 w-[200px]" />
                </div>
              </div>
              <Skeleton className="h-28 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </TooltipProvider>
  );
}
