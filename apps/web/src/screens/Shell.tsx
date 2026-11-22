import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ComponentType, type MouseEvent, type SVGProps } from 'react';
import { api } from '../api.ts';
import { CalendarIcon, CartIcon, GridIcon, LogoutIcon, SearchIcon } from '../components/icons.tsx';
import { Logo } from '../components/Logo.tsx';
import { ProjectScreen } from '../project/ProjectScreen.tsx';
import { useRoute } from '../useRoute.ts';
import { ProjectsScreen } from './ProjectsScreen.tsx';

interface Tab {
  path: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  empty?: string;
}

const TABS: Tab[] = [
  { path: '/today', label: 'Today', Icon: CalendarIcon, empty: 'Overdue items, this week’s due dates and urgent projects will show up here.' },
  { path: '/projects', label: 'Projects', Icon: GridIcon },
  { path: '/buy', label: 'Buy', Icon: CartIcon, empty: 'Everything still to order across all projects, grouped by shop.' },
  { path: '/search', label: 'Search', Icon: SearchIcon, empty: 'Search across projects, checklist items and notes.' },
];

export function Shell() {
  const { path, navigate } = useRoute();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (path === '/' || path === '') {
      window.history.replaceState(null, '', '/projects');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [path]);

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  const active = TABS.find((t) => path.startsWith(t.path)) ?? TABS[1]!;

  const logout = useMutation({
    mutationFn: () => api.post('/api/auth/logout'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  });

  const go = (to: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    navigate(to);
    window.scrollTo(0, 0);
  };

  let content;
  if (projectMatch) content = <ProjectScreen key={projectMatch[1]} id={decodeURIComponent(projectMatch[1]!)} navigate={navigate} />;
  else if (active.path === '/projects') content = <ProjectsScreen navigate={navigate} />;
  else content = <Placeholder tab={active} onLogout={() => logout.mutate()} />;

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface px-3.5 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo className="size-8" />
          <span className="font-display text-lg font-semibold">ProjectBench</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {TABS.map((t) => {
            const current = t === active;
            return (
              <a
                key={t.path}
                href={t.path}
                onClick={go(t.path)}
                aria-current={current ? 'page' : undefined}
                className={`flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm ${
                  current ? 'bg-accent-soft font-semibold text-[#2448C2]' : 'font-medium text-[#3F4450] hover:bg-ground'
                }`}
              >
                <t.Icon width={18} height={18} />
                {t.label}
              </a>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="mt-auto flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted hover:bg-ground"
        >
          <LogoutIcon width={18} height={18} />
          Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {content}

        {/* Mobile tab bar, hidden inside a project */}
        {!projectMatch && (
          <nav
            aria-label="Main"
            className="fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-line bg-surface px-3 pt-2 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden"
          >
            {TABS.map((t) => {
              const current = t === active;
              return (
                <a
                  key={t.path}
                  href={t.path}
                  onClick={go(t.path)}
                  aria-current={current ? 'page' : undefined}
                  className={`flex min-h-11 w-18 flex-col items-center gap-1 text-[11px] ${current ? 'font-semibold text-accent' : 'font-medium text-muted'}`}
                >
                  <t.Icon />
                  {t.label}
                </a>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}

function Placeholder({ tab, onLogout }: { tab: Tab; onLogout: () => void }) {
  return (
    <>
      <header className="flex items-end justify-between px-5 pt-6 pb-3 md:px-8 md:pt-8">
        <h1 className="font-display text-[32px] font-semibold tracking-tight">{tab.label}</h1>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Sign out"
          className="flex size-11 items-center justify-center rounded-full border border-line bg-surface md:hidden"
        >
          <LogoutIcon width={20} height={20} />
        </button>
      </header>
      <main className="flex-1 px-4 pb-28 md:px-8 md:pb-10">
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <tab.Icon width={28} height={28} className="text-muted" />
          <p className="font-semibold">Coming soon</p>
          <p className="max-w-sm text-sm text-muted">{tab.empty}</p>
        </div>
      </main>
    </>
  );
}
