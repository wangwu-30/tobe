import type { Metadata, Viewport } from "next";
import { LanguageProvider } from "@/components/providers/language-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlobalErrorHandlers } from "@/framework/resilience";
import "./globals.css";

export const metadata: Metadata = {
  title: "成形",
  description: "团队与 Agent 共创文档、执行工作和协作解题的工作区",
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#252525' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        suppressHydrationWarning
        className="antialiased"
      >
        <LanguageProvider>
          <TooltipProvider>
            <GlobalErrorHandlers />
            {children}
          </TooltipProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
