import type { Metadata } from "next";
import { Toaster } from "sonner";
import { LayoutShell } from "@/components/layout/layout-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Optio — AI Agent Orchestration",
  description: "Workflow orchestration for AI coding agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <LayoutShell>{children}</LayoutShell>
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  );
}
