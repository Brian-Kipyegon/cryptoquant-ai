import React from "react";
import clsx from "clsx";
import { X } from "lucide-react";

import { cardClassName } from "../utils";

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-zinc-50">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-zinc-400">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  valueTitle,
  hint,
  trend,
}: {
  label: string;
  value: string;
  valueTitle?: string;
  hint?: string;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <div className={cardClassName("p-4")}>
      <div className="text-sm text-zinc-400">{label}</div>
      <div
        className={clsx("mt-3 text-2xl font-semibold", {
          "text-emerald-400": trend === "up",
          "text-rose-400": trend === "down",
          "text-zinc-50": !trend || trend === "neutral",
        })}
        title={valueTitle}
      >
        {value}
      </div>
      {hint ? <div className="mt-2 text-xs text-zinc-500">{hint}</div> : null}
    </div>
  );
}

export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <div className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-zinc-50">{title}</h3>
            {subtitle ? <p className="mt-1 text-sm text-zinc-400">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-xl border border-zinc-700 p-2 text-zinc-300 transition hover:border-zinc-500 hover:text-white"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageLoading({ title = "Loading page..." }: { title?: string }) {
  return (
    <div className={cardClassName("flex min-h-[240px] items-center justify-center text-sm text-zinc-400")}>
      {title}
    </div>
  );
}
