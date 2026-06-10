"use client";

// Admin "Sales Employees" management page — /settings/sales-employees
//
// User management + commission-rate mapping for sales employee dashboards.
// See docs/plans/2026-06-10-sales-employee-dashboards-design.md (Admin UI section).
//
// Brand tabs → employee table (rates, aliases, basis, linked email, active) with
// add/edit dialog, effective-dated rates editor, unmapped-names panel (the accuracy
// guarantee: every revenue name must map to exactly one employee), and an
// "Invite to Cockpit" flow that creates a zero-permission account so the employee
// only sees their own dashboard (middleware self-access).

import { useMemo, useState } from "react";
import Link from "next/link";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useSalesEmployees,
  useSalesEmployeeMutations,
  useUnmappedNames,
  type CreateEmployeePayload,
  type UpdateEmployeePayload,
} from "@/lib/hooks/useSalesEmployees";
import type {
  BrandSlug,
  CommissionBasis,
  SalesEmployeeWithRates,
  UnmappedName,
} from "@/lib/sales-employees/types";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Pencil,
  Percent,
  Plus,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Constants & helpers ───────────────────────────────────────────────────────

const BRANDS: { value: BrandSlug; label: string }[] = [
  { value: "spa", label: "Spa" },
  { value: "aesthetics", label: "Aesthetics" },
  { value: "slimming", label: "Slimming" },
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** 0.06 → "6%", 0.0625 → "6.25%" */
function formatPct(rate: number): string {
  const pct = rate * 100;
  const rounded = Math.round(pct * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}%`;
}

/** "6.5" (percent) → 0.065 (decimal), null if invalid */
function parsePctInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round((n / 100) * 1e6) / 1e6;
}

function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatEuro(n: number): string {
  return `€${Math.round(n).toLocaleString("en-MT")}`;
}

function normName(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong";
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function Chip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-warm-border bg-muted/40 text-foreground/80">
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-red-500 transition-colors"
          aria-label={`Remove ${label}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function AmberChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      {label}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
      {children}
    </label>
  );
}

// ── Employee add/edit dialog ──────────────────────────────────────────────────

interface EmployeeFormState {
  display_name: string;
  slug: string;
  slugTouched: boolean;
  role: string;
  location_name: string;
  user_email: string;
  aliases: string[];
  aliasDraft: string;
  commission_basis: CommissionBasis;
  is_active: boolean;
  notes: string;
  // create-only initial rates
  service_rate: string;
  retail_rate: string;
  effective_from: string;
}

function emptyForm(): EmployeeFormState {
  return {
    display_name: "",
    slug: "",
    slugTouched: false,
    role: "",
    location_name: "",
    user_email: "",
    aliases: [],
    aliasDraft: "",
    commission_basis: "ex_vat",
    is_active: true,
    notes: "",
    service_rate: "",
    retail_rate: "",
    effective_from: toDateInput(new Date()),
  };
}

function formFromEmployee(e: SalesEmployeeWithRates): EmployeeFormState {
  return {
    ...emptyForm(),
    display_name: e.display_name,
    slug: e.slug,
    slugTouched: true,
    role: e.role ?? "",
    location_name: e.location_name ?? "",
    user_email: e.user_email ?? "",
    aliases: [...e.aliases],
    commission_basis: e.commission_basis,
    is_active: e.is_active,
    notes: e.notes ?? "",
  };
}

function EmployeeDialog({
  brand,
  editing,
  prefillName,
  open,
  onClose,
}: {
  brand: BrandSlug;
  /** null = create mode */
  editing: SalesEmployeeWithRates | null;
  /** unmapped name to prefill in create mode */
  prefillName: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { createEmployee, updateEmployee } = useSalesEmployeeMutations();
  const isEdit = editing !== null;

  const [form, setForm] = useState<EmployeeFormState>(emptyForm);
  const [error, setError] = useState("");
  // Re-initialize form when the dialog target changes (render-time state sync)
  const [initKey, setInitKey] = useState<string | null>(null);
  const key = open ? `${isEdit ? `edit-${editing.id}` : `create-${prefillName ?? ""}`}` : null;
  if (key !== initKey) {
    setInitKey(key);
    if (key !== null) {
      if (isEdit) {
        setForm(formFromEmployee(editing));
      } else {
        const f = emptyForm();
        if (prefillName) {
          f.display_name = titleCase(prefillName);
          f.slug = slugify(prefillName);
          f.aliases = [prefillName];
        }
        setForm(f);
      }
      setError("");
    }
  }

  const set = <K extends keyof EmployeeFormState>(k: K, v: EmployeeFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  function addAlias() {
    const a = form.aliasDraft.trim();
    if (!a) return;
    if (form.aliases.some((x) => normName(x) === normName(a))) {
      set("aliasDraft", "");
      return;
    }
    setForm((prev) => ({ ...prev, aliases: [...prev.aliases, a], aliasDraft: "" }));
  }

  const pending = createEmployee.isPending || updateEmployee.isPending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!form.display_name.trim()) {
      setError("Display name is required");
      return;
    }
    try {
      if (isEdit) {
        const payload: UpdateEmployeePayload = {
          id: editing.id,
          display_name: form.display_name.trim(),
          role: form.role.trim() || null,
          location_name: form.location_name.trim() || null,
          user_email: form.user_email.trim() || null,
          aliases: form.aliases,
          commission_basis: form.commission_basis,
          is_active: form.is_active,
          notes: form.notes.trim() || null,
        };
        await updateEmployee.mutateAsync(payload);
      } else {
        const payload: CreateEmployeePayload = {
          display_name: form.display_name.trim(),
          brand_slug: brand,
          slug: form.slug.trim() || undefined,
          role: form.role.trim() || null,
          location_name: form.location_name.trim() || null,
          user_email: form.user_email.trim() || null,
          aliases: form.aliases,
          commission_basis: form.commission_basis,
          is_active: form.is_active,
          notes: form.notes.trim() || null,
        };
        const svc = parsePctInput(form.service_rate);
        const ret = parsePctInput(form.retail_rate);
        if (form.service_rate.trim() !== "" && svc === null) {
          setError("Service % must be a number between 0 and 100");
          return;
        }
        if (form.retail_rate.trim() !== "" && ret === null) {
          setError("Retail % must be a number between 0 and 100");
          return;
        }
        if (svc !== null || ret !== null) {
          payload.service_rate = svc ?? 0;
          payload.retail_rate = ret ?? 0;
          payload.effective_from = form.effective_from;
        }
        await createEmployee.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setError(errMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${editing.display_name}` : "Add employee"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update profile, aliases, and commission basis."
              : `New ${BRANDS.find((b) => b.value === brand)?.label} sales employee.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Display name *</FieldLabel>
              <Input
                value={form.display_name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((prev) => ({
                    ...prev,
                    display_name: name,
                    slug: !isEdit && !prev.slugTouched ? slugify(name) : prev.slug,
                  }));
                }}
                placeholder="Laura Camila"
                required
              />
            </div>
            <div>
              <FieldLabel>Slug {isEdit ? "(fixed)" : ""}</FieldLabel>
              <Input
                value={form.slug}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, slug: slugify(e.target.value), slugTouched: true }))
                }
                placeholder="laura-camila"
                disabled={isEdit}
                className={isEdit ? "opacity-60" : undefined}
              />
            </div>
            <div>
              <FieldLabel>Role</FieldLabel>
              <Input
                value={form.role}
                onChange={(e) => set("role", e.target.value)}
                placeholder="Therapist / Consultant"
              />
            </div>
            <div>
              <FieldLabel>Location</FieldLabel>
              <Input
                value={form.location_name}
                onChange={(e) => set("location_name", e.target.value)}
                placeholder="Ramla"
              />
            </div>
            <div>
              <FieldLabel>Linked email</FieldLabel>
              <Input
                type="email"
                value={form.user_email}
                onChange={(e) => set("user_email", e.target.value)}
                placeholder="employee@carismaspa.com"
              />
            </div>
            <div>
              <FieldLabel>Commission basis</FieldLabel>
              <select
                value={form.commission_basis}
                onChange={(e) => set("commission_basis", e.target.value as CommissionBasis)}
                className="w-full h-8 text-sm border border-warm-border rounded-md px-2 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
              >
                <option value="ex_vat">Ex-VAT (default)</option>
                <option value="inc_vat">Inc-VAT</option>
              </select>
            </div>
          </div>

          {/* Aliases */}
          <div>
            <FieldLabel>Aliases (names as they appear in revenue data)</FieldLabel>
            <div className="flex flex-wrap gap-1.5 mb-2 min-h-[22px]">
              {form.aliases.map((a) => (
                <Chip
                  key={a}
                  label={a}
                  onRemove={() =>
                    setForm((prev) => ({ ...prev, aliases: prev.aliases.filter((x) => x !== a) }))
                  }
                />
              ))}
              {form.aliases.length === 0 && (
                <span className="text-xs text-muted-foreground">No aliases yet</span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                value={form.aliasDraft}
                onChange={(e) => set("aliasDraft", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAlias();
                  }
                }}
                placeholder="LAURA CAMILA"
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={addAlias}>
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </div>

          {/* Initial rates — create only */}
          {!isEdit && (
            <div className="rounded-lg border border-warm-border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Initial commission rates (optional)
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <FieldLabel>Service %</FieldLabel>
                  <Input
                    inputMode="decimal"
                    value={form.service_rate}
                    onChange={(e) => set("service_rate", e.target.value)}
                    placeholder="6"
                  />
                </div>
                <div>
                  <FieldLabel>Retail %</FieldLabel>
                  <Input
                    inputMode="decimal"
                    value={form.retail_rate}
                    onChange={(e) => set("retail_rate", e.target.value)}
                    placeholder="10"
                  />
                </div>
                <div>
                  <FieldLabel>Effective from</FieldLabel>
                  <Input
                    type="date"
                    value={form.effective_from}
                    onChange={(e) => set("effective_from", e.target.value)}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">
                Enter percentages (6 = 6%). Leave blank to set rates later — commission shows €0
                with a &ldquo;rates not set&rdquo; flag until then.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(c) => set("is_active", c)} />
              <span className="text-sm text-foreground">{form.is_active ? "Active" : "Inactive"}</span>
            </div>
          </div>

          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className="w-full text-sm border border-warm-border rounded-md px-2.5 py-1.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40 resize-y"
              placeholder="Optional notes…"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save changes" : "Create employee"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Rates editor dialog ───────────────────────────────────────────────────────

function RatesDialog({
  employee,
  open,
  onClose,
}: {
  employee: SalesEmployeeWithRates | null;
  open: boolean;
  onClose: () => void;
}) {
  const { upsertRate, deleteRate } = useSalesEmployeeMutations();
  const [service, setService] = useState("");
  const [retail, setRetail] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(toDateInput(new Date()));
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Reset form when target employee changes
  const [lastId, setLastId] = useState<number | null>(null);
  if (open && employee && employee.id !== lastId) {
    setLastId(employee.id);
    setService("");
    setRetail("");
    setEffectiveFrom(toDateInput(new Date()));
    setError("");
  }

  if (!employee) return null;

  const history = [...employee.rate_history].sort((a, b) =>
    b.effective_from.localeCompare(a.effective_from)
  );

  async function addRevision(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!employee) return;
    const svc = parsePctInput(service);
    const ret = parsePctInput(retail);
    if (svc === null || ret === null) {
      setError("Enter both rates as percentages between 0 and 100 (e.g. 6 = 6%)");
      return;
    }
    if (!effectiveFrom) {
      setError("Effective-from date is required");
      return;
    }
    try {
      await upsertRate.mutateAsync({
        employee_id: employee.id,
        service_rate: svc,
        retail_rate: ret,
        effective_from: effectiveFrom,
      });
      setService("");
      setRetail("");
    } catch (err) {
      setError(errMessage(err));
    }
  }

  async function removeRevision(id: number) {
    if (!confirm("Delete this rate revision? Commission for dates it covered will fall back to the previous revision (or 0).")) return;
    setDeletingId(id);
    try {
      await deleteRate.mutateAsync(id);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Commission rates — {employee.display_name}</DialogTitle>
          <DialogDescription>
            The rate applied to each sale is the revision in effect on the sale date — past
            commissions stay accurate when rates change.
          </DialogDescription>
        </DialogHeader>

        {/* History */}
        <div className="border border-warm-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-warm-border bg-muted/30">
                <th className="text-left py-2 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Effective from</th>
                <th className="text-right py-2 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Service</th>
                <th className="text-right py-2 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Retail</th>
                <th className="py-2 px-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 px-3 text-center text-xs text-muted-foreground">
                    No rate revisions yet — commission computes as €0 until one is added.
                  </td>
                </tr>
              )}
              {history.map((r, idx) => (
                <tr key={r.id} className="border-b border-warm-border/50 last:border-0">
                  <td className="py-2 px-3 text-foreground">
                    {r.effective_from}
                    {idx === 0 && (
                      <span className="ml-2 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-px">
                        latest
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-medium tabular-nums">{formatPct(r.service_rate)}</td>
                  <td className="py-2 px-3 text-right font-medium tabular-nums">{formatPct(r.retail_rate)}</td>
                  <td className="py-2 px-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeRevision(r.id)}
                      disabled={deletingId === r.id}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                      aria-label="Delete revision"
                    >
                      {deletingId === r.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add revision */}
        <form onSubmit={addRevision} className="rounded-lg border border-warm-border bg-muted/20 p-3 space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Add revision</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FieldLabel>Service %</FieldLabel>
              <Input inputMode="decimal" value={service} onChange={(e) => setService(e.target.value)} placeholder="6" />
            </div>
            <div>
              <FieldLabel>Retail %</FieldLabel>
              <Input inputMode="decimal" value={retail} onChange={(e) => setRetail(e.target.value)} placeholder="10" />
            </div>
            <div>
              <FieldLabel>Effective from</FieldLabel>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
            </div>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={upsertRate.isPending}>
              {upsertRate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Percent className="h-3.5 w-3.5" />}
              Save revision
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Invite to Cockpit dialog ──────────────────────────────────────────────────

function InviteDialog({
  employee,
  open,
  onClose,
}: {
  employee: SalesEmployeeWithRates | null;
  open: boolean;
  onClose: () => void;
}) {
  const { updateEmployee } = useSalesEmployeeMutations();
  const [email, setEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  // Reset when target changes
  const [lastId, setLastId] = useState<number | null>(null);
  if (open && employee && employee.id !== lastId) {
    setLastId(employee.id);
    setEmail(employee.user_email ?? "");
    setError("");
    setTempPassword(null);
  }

  if (!employee) return null;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (!employee) return;
    const normalised = email.trim().toLowerCase();
    if (!normalised) {
      setError("Email is required");
      return;
    }
    setInviting(true);
    setError("");
    setTempPassword(null);
    try {
      // Zero dashboard permissions — middleware self-access grants exactly
      // their own /sales/{brand}/employees/{slug} page.
      const res = await fetch("/api/admin/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalised, permissions: [] }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Failed to invite");
        return;
      }
      // Persist the linked email on the employee so middleware can match them.
      await updateEmployee.mutateAsync({ id: employee.id, user_email: normalised });
      setTempPassword(body.tempPassword ?? null);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setInviting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite {employee.display_name} to Cockpit</DialogTitle>
          <DialogDescription>
            Creates a Cockpit login with no dashboard permissions. The employee will only see
            their own dashboard (/sales/{employee.brand_slug}/employees/{employee.slug}).
          </DialogDescription>
        </DialogHeader>

        {tempPassword ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1">
            <p className="text-xs font-semibold text-emerald-700">Account created — share these credentials:</p>
            <p className="text-xs text-emerald-800">They can log in immediately at the Cockpit login page.</p>
            <div className="flex items-center gap-2 mt-1.5">
              <code className="text-sm font-mono font-bold text-emerald-900 bg-emerald-100 px-2 py-1 rounded">
                {tempPassword}
              </code>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(tempPassword)}
                className="text-xs text-emerald-600 hover:underline font-medium"
              >
                Copy
              </button>
            </div>
            <p className="text-[11px] text-emerald-600 mt-1">Ask them to change their password after first login.</p>
          </div>
        ) : (
          <form onSubmit={invite} className="space-y-4">
            <div>
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="employee@carismaspa.com"
                required
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={inviting}>
                Cancel
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Invite
              </Button>
            </DialogFooter>
          </form>
        )}
        {tempPassword && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Done</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Unmapped names panel ──────────────────────────────────────────────────────

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  return { from: toDateInput(from), to: toDateInput(to) };
}

function UnmappedPanel({
  brand,
  employees,
  disabled,
  onCreateFromName,
}: {
  brand: BrandSlug;
  employees: SalesEmployeeWithRates[];
  disabled: boolean;
  onCreateFromName: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [{ from, to }, setRange] = useState(defaultRange);
  const [aliasSaving, setAliasSaving] = useState<string | null>(null);
  const [aliasError, setAliasError] = useState("");
  const { updateEmployee } = useSalesEmployeeMutations();

  const fromDate = useMemo(() => new Date(`${from}T00:00:00`), [from]);
  const toDate = useMemo(() => new Date(`${to}T00:00:00`), [to]);
  const { unmapped, isLoading, isError, error, refetch } = useUnmappedNames(
    brand,
    fromDate,
    toDate,
    open && !disabled
  );

  async function addAsAlias(name: string, employeeId: number) {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp) return;
    setAliasSaving(name);
    setAliasError("");
    try {
      const already = emp.aliases.some((a) => normName(a) === normName(name));
      if (!already) {
        await updateEmployee.mutateAsync({ id: emp.id, aliases: [...emp.aliases, name] });
      }
      refetch();
    } catch (err) {
      setAliasError(errMessage(err));
    } finally {
      setAliasSaving(null);
    }
  }

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/30 transition-colors disabled:opacity-50"
      >
        <div>
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Unmapped revenue names
            {open && !isLoading && !isError && (
              <span className={cn(
                "text-[11px] font-semibold px-1.5 py-px rounded-full border",
                unmapped.length > 0
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              )}>
                {unmapped.length}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every name listed here is earning unattributed revenue — map each one to an employee
            to keep commissions accurate.
          </p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>

      {open && !disabled && (
        <div className="border-t border-warm-border">
          {/* Date range */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-muted/20 border-b border-warm-border">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Scan window</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="text-xs border border-warm-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="text-xs border border-warm-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40"
            />
            <span className="text-[11px] text-muted-foreground ml-auto">defaults to last 90 days</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <p className="text-xs text-red-500 px-4 py-4">{error ?? "Failed to scan revenue data"}</p>
          ) : unmapped.length === 0 ? (
            <p className="text-sm text-emerald-700 px-4 py-4">
              All revenue names in this window map to an employee. Nothing is unattributed.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-warm-border bg-muted/30">
                  <th className="text-left py-2 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Name in data</th>
                  <th className="text-left py-2 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-20">Kind</th>
                  <th className="text-right py-2 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-24">Revenue</th>
                  <th className="text-right py-2 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-14">Tx</th>
                  <th className="text-left py-2 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-28">Last seen</th>
                  <th className="text-right py-2 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-72">Map to employee</th>
                </tr>
              </thead>
              <tbody>
                {unmapped.map((u: UnmappedName) => (
                  <tr key={`${u.name}-${u.kind}`} className="border-b border-warm-border/50 last:border-0">
                    <td className="py-2 px-4 font-medium text-foreground">{u.name}</td>
                    <td className="py-2 px-3">
                      <span className={cn(
                        "text-[11px] font-semibold px-1.5 py-px rounded-full border",
                        u.kind === "retail"
                          ? "border-violet-200 bg-violet-50 text-violet-700"
                          : "border-blue-200 bg-blue-50 text-blue-700"
                      )}>
                        {u.kind}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{formatEuro(u.revenue)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{u.tx_count}</td>
                    <td className="py-2 px-3 text-muted-foreground">{u.last_seen}</td>
                    <td className="py-2 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <select
                          defaultValue=""
                          disabled={aliasSaving === u.name}
                          onChange={(e) => {
                            const id = Number(e.target.value);
                            if (id) addAsAlias(u.name, id);
                            e.target.value = "";
                          }}
                          className="text-xs border border-warm-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-gold/40 max-w-[160px]"
                        >
                          <option value="" disabled>Add as alias to…</option>
                          {employees.map((emp) => (
                            <option key={emp.id} value={emp.id}>{emp.display_name}</option>
                          ))}
                        </select>
                        {aliasSaving === u.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            onClick={() => onCreateFromName(u.name)}
                          >
                            <Plus className="h-3 w-3" /> Create employee
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {aliasError && <p className="text-xs text-red-500 px-4 py-2">{aliasError}</p>}
        </div>
      )}
    </Card>
  );
}

// ── Per-brand panel ───────────────────────────────────────────────────────────

function MigrationBanner() {
  return (
    <div className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-800">Migration required</p>
        <p className="text-sm text-amber-700 mt-0.5">
          Run <code className="font-mono text-xs bg-amber-100 px-1.5 py-0.5 rounded">supabase/migrations/073_create_sales_employees.sql</code>{" "}
          in the Supabase SQL editor, then re-open this page and use &ldquo;Seed from sales data&rdquo;.
        </p>
      </div>
    </div>
  );
}

function BrandPanel({ brand }: { brand: BrandSlug }) {
  const { employees, isLoading, isError, error, migrationMissing, refetch } = useSalesEmployees(brand);
  const { updateEmployee, deleteEmployee } = useSalesEmployeeMutations();

  // Dialog state
  const [employeeDialogOpen, setEmployeeDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SalesEmployeeWithRates | null>(null);
  const [prefillName, setPrefillName] = useState<string | null>(null);
  const [ratesFor, setRatesFor] = useState<SalesEmployeeWithRates | null>(null);
  const [inviteFor, setInviteFor] = useState<SalesEmployeeWithRates | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState("");

  // Keep dialog targets fresh after react-query refetches (e.g. rate upsert)
  const liveRatesFor = ratesFor ? employees.find((e) => e.id === ratesFor.id) ?? ratesFor : null;
  const liveInviteFor = inviteFor ? employees.find((e) => e.id === inviteFor.id) ?? inviteFor : null;
  const liveEditing = editing ? employees.find((e) => e.id === editing.id) ?? editing : null;

  function openCreate(prefill: string | null = null) {
    setEditing(null);
    setPrefillName(prefill);
    setEmployeeDialogOpen(true);
  }

  function openEdit(emp: SalesEmployeeWithRates) {
    setEditing(emp);
    setPrefillName(null);
    setEmployeeDialogOpen(true);
  }

  async function toggleActive(emp: SalesEmployeeWithRates) {
    setTogglingId(emp.id);
    setRowError("");
    try {
      await updateEmployee.mutateAsync({ id: emp.id, is_active: !emp.is_active });
    } catch (err) {
      setRowError(errMessage(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(emp: SalesEmployeeWithRates) {
    if (!confirm(`Delete ${emp.display_name}? Their rate history is removed too. Revenue data is untouched — their names will reappear in the unmapped panel.`)) return;
    setDeletingId(emp.id);
    setRowError("");
    try {
      await deleteEmployee.mutateAsync(emp.id);
    } catch (err) {
      setRowError(errMessage(err));
    } finally {
      setDeletingId(null);
    }
  }

  if (migrationMissing) {
    return (
      <div className="space-y-4">
        <MigrationBanner />
        <div className="opacity-50 pointer-events-none select-none">
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Employee management is disabled until the migration is applied.
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/sales/${brand}/employees`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open {BRANDS.find((b) => b.value === brand)?.label} employee dashboards
        </Link>
        <Button size="sm" onClick={() => openCreate()}>
          <Plus className="h-3.5 w-3.5" /> Add employee
        </Button>
      </div>

      {rowError && <p className="text-xs text-red-500">{rowError}</p>}

      {/* Employee table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <Card className="p-6 text-center space-y-2">
          <p className="text-sm text-red-500">{error ?? "Failed to load employees"}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </Card>
      ) : employees.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No {BRANDS.find((b) => b.value === brand)?.label} employees yet. Add one manually or use
          the unmapped names panel below to create them from revenue data.
        </Card>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-warm-border bg-muted/30">
                <th className="text-left py-2.5 px-4 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Employee</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Role / Location</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Aliases</th>
                <th className="text-right py-2.5 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-24">Service / Retail</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-16">Basis</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Login</th>
                <th className="text-left py-2.5 px-3 text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-16">Active</th>
                <th className="py-2.5 px-4 text-right text-[11px] font-medium text-muted-foreground uppercase tracking-wider w-44">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, idx) => (
                <tr
                  key={emp.id}
                  className={cn(
                    "border-b border-warm-border/50 last:border-0 transition-colors",
                    !emp.is_active && "opacity-50",
                    idx % 2 === 1 && "bg-muted/10"
                  )}
                >
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-foreground">{emp.display_name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{emp.slug}</p>
                  </td>
                  <td className="py-2.5 px-3 text-foreground/80">
                    <p>{emp.role ?? <span className="text-muted-foreground">—</span>}</p>
                    {emp.location_name && (
                      <p className="text-[11px] text-muted-foreground">{emp.location_name}</p>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex flex-wrap gap-1 max-w-[220px]">
                      {emp.aliases.length === 0
                        ? <span className="text-xs text-muted-foreground">—</span>
                        : emp.aliases.map((a) => <Chip key={a} label={a} />)}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {emp.current_rates ? (
                      <span className="font-medium tabular-nums">
                        {formatPct(emp.current_rates.service_rate)}
                        <span className="text-muted-foreground font-normal"> / </span>
                        {formatPct(emp.current_rates.retail_rate)}
                      </span>
                    ) : (
                      <AmberChip label="rates not set" />
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="text-[11px] font-semibold px-1.5 py-px rounded border border-warm-border bg-muted/40 text-foreground/70 uppercase">
                      {emp.commission_basis === "ex_vat" ? "ex-VAT" : "inc-VAT"}
                    </span>
                  </td>
                  <td className="py-2.5 px-3">
                    {emp.user_email ? (
                      <span className="text-xs text-foreground/80 break-all">{emp.user_email}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">not linked</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {togglingId === emp.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Switch checked={emp.is_active} onCheckedChange={() => toggleActive(emp)} />
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="xs" onClick={() => openEdit(emp)} title="Edit profile">
                        <Pencil className="h-3 w-3" /> Edit
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setRatesFor(emp)} title="Commission rates">
                        <Percent className="h-3 w-3" /> Rates
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setInviteFor(emp)}
                        title={emp.user_email ? `Invite ${emp.user_email}` : "Set an email and invite"}
                      >
                        <UserPlus className="h-3 w-3" /> Invite
                      </Button>
                      <button
                        type="button"
                        onClick={() => remove(emp)}
                        disabled={deletingId === emp.id}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                        aria-label={`Delete ${emp.display_name}`}
                      >
                        {deletingId === emp.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Unmapped names — the accuracy guarantee */}
      <UnmappedPanel
        brand={brand}
        employees={employees}
        disabled={isLoading || isError}
        onCreateFromName={(name) => openCreate(name)}
      />

      {/* Dialogs */}
      <EmployeeDialog
        brand={brand}
        editing={liveEditing}
        prefillName={prefillName}
        open={employeeDialogOpen}
        onClose={() => {
          setEmployeeDialogOpen(false);
          setEditing(null);
          setPrefillName(null);
        }}
      />
      <RatesDialog
        employee={liveRatesFor}
        open={ratesFor !== null}
        onClose={() => setRatesFor(null)}
      />
      <InviteDialog
        employee={liveInviteFor}
        open={inviteFor !== null}
        onClose={() => setInviteFor(null)}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SalesEmployeesPage() {
  const [brand, setBrand] = useState<BrandSlug>("spa");

  return (
    <DashboardShell hideDatePicker>
      {() => (
        <div className="p-4 md:p-6 max-w-6xl space-y-5">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Sales Employees</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage sales employees, their commission rates, and revenue-name mappings.
              Commission rates are effective-dated: each sale uses the revision in effect on
              the sale date, so historical commissions stay accurate when rates change.
            </p>
          </div>

          <Tabs value={brand} onValueChange={(v) => setBrand(v as BrandSlug)}>
            <TabsList>
              {BRANDS.map((b) => (
                <TabsTrigger key={b.value} value={b.value} className="px-4">
                  {b.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {BRANDS.map((b) => (
              <TabsContent key={b.value} value={b.value} className="mt-2">
                <BrandPanel brand={b.value} />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      )}
    </DashboardShell>
  );
}
