import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ComponentType, type MouseEvent, type SVGProps } from 'react';
import { api } from '../api.ts';
import { CalendarIcon, CartIcon, GridIcon, LogoutIcon, SearchIcon, SettingsIcon } from '../components/icons.tsx';
import { Logo } from '../components/Logo.tsx';
import { OfflineBanner } from '../components/OfflineBanner.tsx';
import { ProjectScreen } from '../project/ProjectScreen.tsx';
import { useRoute } from '../useRoute.ts';
import { BuyScreen } from './BuyScreen.tsx';
import { ProjectsScreen } from './ProjectsScreen.tsx';
import { SearchScreen } from './SearchScreen.tsx';
import { SettingsScreen } from './SettingsScreen.tsx';
import { TodayScreen } from './TodayScreen.tsx';

interface Tab {
  path: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const TABS: Tab[] = [
  { path: '/today', label: 'Today', Icon: CalendarIcon },
  { path: '/projects', label: 'Projects', Icon: GridIcon },
  { path: '/buy', label: 'Buy', Icon: CartIcon },
  { path: '/search', label: 'Search', Icon: SearchIcon },
];

export function Shell() {
  const { path, navigate } = useRoute();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (path === '/' || path === '') {
      window.history.replaceState(null, '', '/today');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [path]);

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  const inSettings = path.startsWith('/settings');
  const active = inSettings ? undefined : (TABS.find((t) => path.startsWith(t.path)) ?? TABS[1]!);

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
  else if (!active) content = <SettingsScreen onLogout={() => logout.mutate()} />;
  else if (active.path === '/today') content = <TodayScreen navigate={navigate} />;
  else if (active.path === '/buy') content = <BuyScreen navigate={navigate} />;
  else if (active.path === '/search') content = <SearchScreen navigate={navigate} />;
  else content = <ProjectsScreen navigate={navigate} />;

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
        <a
          href="/settings"
          onClick={go('/settings')}
          aria-current={inSettings ? 'page' : undefined}
          className={`mt-auto -mb-5 flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm ${
            inSettings ? 'bg-accent-soft font-semibold text-[#2448C2]' : 'font-medium text-muted hover:bg-ground'
          }`}
        >
          <SettingsIcon width={18} height={18} />
          Settings
        </a>
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-muted hover:bg-ground"
        >
          <LogoutIcon width={18} height={18} />
          Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
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
