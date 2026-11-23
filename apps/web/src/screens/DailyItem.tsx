import type { ItemWithContext } from '@projectbench/core/schemas';
import type { MouseEvent, ReactNode } from 'react';
import { useItemState } from '../lib/queries.ts';
import { actionLabel, nextState, StateMark } from '../project/ItemRow.tsx';

export type Navigate = (to: string) => void;

/** A same-app link that still opens in a new tab with a modifier key. */
export function appLink(to: string, navigate: Navigate) {
  return {
    href: to,
    onClick: (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      navigate(to);
      window.scrollTo(0, 0);
    },
  };
}

interface Props {
  item: ItemWithContext;
  navigate: Navigate;
  meta: ReactNode;
  /** Shown at the end of the title line, such as a date or quantity. */
  trailing?: ReactNode;
  children?: ReactNode;
}

/** An item in a cross-project list: state button, title linking to its project, details. */
export function DailyItem({ item, navigate, meta, trailing, children }: Props) {
  const change = useItemState();
  const toggle = () => change.mutate({ id: item.id, projectId: item.projectId, state: nextState(item.checklistKind, item.state) });

  return (
    <li className={`flex items-start gap-0.5 border-b border-line-soft py-1 pr-3.5 pl-1 last:border-b-0 ${change.isPending ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={change.isPending}
        aria-label={`${actionLabel(item.checklistKind, item.state)}: ${item.text}`}
        className="flex size-11 shrink-0 items-center justify-center"
      >
        <StateMark state={item.state} />
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-[9px]">
        <div className="flex items-baseline gap-2">
          <a {...appLink(`/projects/${item.projectId}`, navigate)} className="min-w-0 flex-1 text-[15px] leading-snug font-medium hover:underline">
            {item.text}
          </a>
          {trailing}
        </div>
        <span className="text-xs text-muted">{meta}</span>
        {children}
        {change.isError && (
          <span role="alert" className="text-xs text-danger">
            {change.error.message}
          </span>
        )}
      </div>
    </li>
  );
}
