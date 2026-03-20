"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  ListTodo,
  Plus,
  KeyRound,
  Settings,
  Zap,
  FolderGit2,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard, indent: false },
  { href: "/tasks", label: "Tasks", icon: ListTodo, indent: false },
  { href: "/tasks/new", label: "New Task", icon: Plus, indent: true },
  { href: "/repos", label: "Repos", icon: FolderGit2, indent: false },
  { href: "/secrets", label: "Secrets", icon: KeyRound, indent: false },
  { href: "/settings", label: "Settings", icon: Settings, indent: false },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-bg flex flex-col">
      <div className="p-4 border-b border-border">
        <Link href="/" className="flex items-center gap-2 text-primary font-bold text-lg">
          <Zap className="w-5 h-5" />
          Optio
        </Link>
      </div>
      <nav className="flex-1 p-2 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 py-2 rounded-md text-sm transition-colors",
                item.indent ? "pl-9 pr-3" : "px-3",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-text-muted hover:bg-bg-hover hover:text-text"
              )}
            >
              <item.icon className={cn("shrink-0", item.indent ? "w-3.5 h-3.5" : "w-4 h-4")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="p-4 border-t border-border text-xs text-text-muted">
        Optio v0.1.0
      </div>
    </aside>
  );
}
