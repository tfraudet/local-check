import type { ComponentPropsWithoutRef } from 'react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from './ui/button';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import helpDocumentation from '@/doc/help.md?raw';
import { STATUS_COLORS } from '@/domain/phaseColors';

interface HelpPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const markdownComponents: Components = {
  h1: () => null,
  h2: ({ children }: ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="mt-8 mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="mt-5 mb-2 text-sm font-semibold text-foreground">{children}</h3>
  ),
  p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
    <p className="my-3 text-sm leading-relaxed text-foreground/90">{children}</p>
  ),
  ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
    <ul className="my-3 ml-5 list-disc space-y-1.5 text-sm text-foreground/90 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
    <ol className="my-3 ml-5 list-decimal space-y-1.5 text-sm text-foreground/90 marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }: ComponentPropsWithoutRef<'li'>) => (
    <li className="leading-relaxed">{children}</li>
  ),
  blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="my-4 rounded-r-md border-l-4 border-primary bg-muted/60 px-4 py-3 text-sm text-foreground/90 [&>p]:my-0">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }: ComponentPropsWithoutRef<'code'>) => {
    const isInline = !className;
    if (isInline) {
      return (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-4 overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>
  ),
  a: ({ href, children }: ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-6 border-border" />,
  strong: ({ children }: ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  table: ({ children }: ComponentPropsWithoutRef<'table'>) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }: ComponentPropsWithoutRef<'th'>) => (
    <th className="border-b border-border px-3 py-2 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }: ComponentPropsWithoutRef<'td'>) => (
    <td className="border-b border-border/60 px-3 py-2 text-foreground/90">{children}</td>
  ),
};

export function HelpPanel({ open, onOpenChange }: HelpPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-3/4! max-w-none! sm:w-3/4! sm:max-w-none!"
      >
        <SheetHeader className="border-b border-border pb-4">
          <div className="flex items-center gap-3">
            <SheetTitle className="text-2xl font-bold">
              <span style={{ color: STATUS_COLORS['in-local'] }}>Local</span>{' '}
              <span style={{ color: STATUS_COLORS['in-local-marginal'] }}>Check</span>
            </SheetTitle>
            <span
              className="rounded px-1 py-px font-mono text-[10px] font-medium leading-none text-white"
              style={{ backgroundColor: STATUS_COLORS['out-of-local'] }}
            >
              v{__APP_VERSION__}
            </span>
          </div>
          <SheetDescription>
            Post-flight local-verification for glider pilots — user guide.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {helpDocumentation}
          </ReactMarkdown>
        </div>

        <SheetFooter>
          <SheetClose render={<Button variant="outline">Close</Button>} />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
