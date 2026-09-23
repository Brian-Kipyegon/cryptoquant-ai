import React from "react";
import clsx from "clsx";
import { Bot } from "lucide-react";

import type { AppPage } from "../api";
import { NAV_ITEMS } from "../utils";

export function Sidebar({
  page,
  onSelectPage,
}: {
  page: AppPage;
  onSelectPage: (page: AppPage) => void;
}) {
  return (
    <aside className="border-r border-zinc-800 bg-zinc-950/95 px-4 py-6">
      <div className="mb-8 flex items-center gap-3 px-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-300">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-zinc-50">CryptoQuantAI</div>
          <div className="text-xs text-zinc-500">源码控制台</div>
        </div>
      </div>

      <nav className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.key}
              onClick={() => onSelectPage(item.key)}
              className={clsx(
                "flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm transition",
                page === item.key
                  ? "bg-indigo-500/15 text-indigo-200"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

    </aside>
  );
}
