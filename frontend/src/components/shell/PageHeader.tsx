import type { ReactNode } from "react";
import { cx } from "../../lib/format";

export function PageHeader({
  title,
  lead,
  actions,
  className,
}: {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("mb-6 flex flex-wrap items-end justify-between gap-4 pt-2 lg:mb-8", className)}>
      <div className="min-w-0">
        <h1 className="display-tight text-[40px] leading-[0.95] font-semibold text-frost sm:text-[52px]">{title}</h1>
        {lead && <p className="mt-2 max-w-xl text-[15px] text-mist">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
