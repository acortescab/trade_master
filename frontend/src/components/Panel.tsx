import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}

export function Panel({ title, aside, children, className = "", bodyClassName = "", testId }: PanelProps) {
  return (
    <section
      data-testid={testId}
      aria-label={title}
      className={`flex min-h-0 min-w-0 flex-col border border-line bg-panel ${className}`}
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
        <h2 className="text-[13px] font-medium text-ink-2">{title}</h2>
        {aside}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
