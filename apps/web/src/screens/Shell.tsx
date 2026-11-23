import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, type ComponentType, type MouseEvent, type SVGProps } from 'react';
import { api } from '../api.ts';
import { CalendarIcon, CartIcon, GridIcon, LogoutIcon, SearchIcon, SettingsIcon } from '../components/icons.tsx';
import { Logo } from '../components/Logo.tsx';
import { OfflineBanner } from '../components/OfflineBanner.tsx';
import { ThemeToggle } from '../components/ThemeToggle.tsx';
import { useTags } from '../lib/queries.ts';
import { ProjectScreen } from '../project/ProjectScreen.tsx';
import { useRoute, useTagFilter } from '../useRoute.ts';
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

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function Shell() {
  const { path, navigate: goTo } = useRoute();
  const [currentTag] = useTagFilter();
  const queryClient = useQueryClient();
  const tags = useTags();
  const backTo = useRef('/projects');

  useEffect(() => {
    if (path === '/' || path === '') {
      window.history.replaceState(null, '', '/today');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [path]);

  const projectMatch = path.match(/^\/projects\/([^/]+)$/);
  const inSettings = path.startsWith('/settings');
  const active = inSettings ? undefined : (TABS.find((t) => path.startsWith(t.path)) ?? TABS[1]!);

  /** Remembers the list a project was opened from, so its back link returns there. */
  const navigate = useCallback(
    (to: string) => {
      if (!/^\/projects\/[^/]+$/.test(window.location.pathname)) backTo.current = window.location.pathname + window.location.search;
      goTo(to);
    },
    [goTo],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const command = e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);
      if (!command && (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target))) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (window.location.pathname === '/search') document.getElementById('global-search')?.focus();
      else navigate('/search');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

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

  const backPath = backTo.current.split('?')[0]!;
  const back = { to: backTo.current, label: backPath === '/settings' ? 'Settings' : (TABS.find((t) => t.path === backPath)?.label ?? 'Projects') };

  let content;
  if (projectMatch) content = <ProjectScreen key={projectMatch[1]} id={decodeURIComponent(projectMatch[1]!)} navigate={navigate} back={back} />;
  else if (!active) content = <SettingsScreen onLogout={() => logout.mutate()} />;
  else if (active.path === '/today') content = <TodayScreen navigate={navigate} />;
  else if (active.path === '/buy') content = <BuyScreen navigate={navigate} />;
  else if (active.path === '/search') content = <SearchScreen navigate={navigate} />;
  else content = <ProjectsScreen navigate={navigate} />;

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-5 border-r border-line bg-surface px-3.5 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo className="size-8" />
          <span className="font-display text-lg font-semibold">ProjectBench</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {TABS.map((t) => {
            const current = t === active && !(t.path === '/projects' && currentTag);
            return (
              <a
                key={t.path}
                href={t.path}
                onClick={go(t.path)}
                aria-current={current ? 'page' : undefined}
                className={`flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm ${
                  current ? 'bg-accent-soft font-semibold text-accent-ink' : 'font-medium text-ink-soft hover:bg-ground'
                }`}
              >
                <t.Icon width={18} height={18} />
                {t.label}
                {t.path === '/search' && (
                  <kbd className="ml-auto rounded border border-line px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
                )}
              </a>
            );
          })}
        </nav>
        {!!tags.data?.length && (
          <nav aria-label="Tags" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
            <h2 className="px-2.5 pb-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">Tags</h2>
            {tags.data.map((t) => {
              const to = `/projects?tag=${encodeURIComponent(t.name)}`;
              const current = active?.path === '/projects' && !projectMatch && currentTag === t.name;
              return (
                <a
                  key={t.name}
                  href={to}
                  onClick={go(to)}
                  aria-current={current ? 'page' : undefined}
                  className={`flex min-h-8 shrink-0 items-center justify-between gap-2 rounded-lg px-2.5 text-[13px] ${
                    current ? 'bg-accent-soft font-semibold text-accent-ink' : 'font-medium text-ink-soft hover:bg-ground'
                  }`}
                >
                  <span className="truncate">#{t.name}</span>
                  <span className="text-xs text-muted">{t.projects}</span>
                </a>
              );
            })}
          </nav>
        )}
        <div className="mt-auto flex flex-col gap-1">
          <ThemeToggle compact />
          <a
            href="/settings"
            onClick={go('/settings')}
            aria-current={inSettings ? 'page' : undefined}
            className={`flex h-10 items-center gap-2.5 rounded-lg px-2.5 text-sm ${
              inSettings ? 'bg-accent-soft font-semibold text-accent-ink' : 'font-medium text-muted hover:bg-ground'
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
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <div className="mx-auto flex w-full max-w-[84rem] flex-1 flex-col">{content}</div>

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
                  className={`flex min-h-11 w-18 flex-col items-center gap-1 text-[11px] ${current ? 'font-semibold text-accent-ink' : 'font-medium text-muted'}`}
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
