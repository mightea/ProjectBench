import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ComponentType, type MouseEvent, type SVGProps } from 'react';
import { api } from '../api.ts';
import { CalendarIcon, CartIcon, GridIcon, LogoutIcon, PlusIcon, SearchIcon, SettingsIcon } from '../components/icons.tsx';
import { Logo } from '../components/Logo.tsx';
import { OfflineBanner } from '../components/OfflineBanner.tsx';
import { ProjectTile } from '../components/ProjectTile.tsx';
import { STATUS_META } from '../lib/format.ts';
import { useProjects, useTags } from '../lib/queries.ts';
import { CONTENT_WIDTH } from '../lib/look.ts';
import { ProjectScreen } from '../project/ProjectScreen.tsx';
import { useRoute, useTagFilter } from '../useRoute.ts';
import { BuyScreen } from './BuyScreen.tsx';
import { NewProjectSheet } from './NewProjectSheet.tsx';
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

/** Tags shown in the sidebar before "+n more". */
const SIDEBAR_TAGS = 4;

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function Shell() {
  const { path, navigate: goTo } = useRoute();
  const [currentTag] = useTagFilter();
  const queryClient = useQueryClient();
  const tags = useTags();
  const projects = useProjects({ status: 'open', sort: 'priority' });
  const [creating, setCreating] = useState(false);
  const [allTags, setAllTags] = useState(false);
  const backTo = useRef('/projects');
  const toBuy = projects.data?.reduce((n, p) => n + p.kinds.buy.total - p.kinds.buy.done - p.kinds.buy.ordered, 0) ?? 0;
  const sidebarTags = allTags ? tags.data : tags.data?.slice(0, SIDEBAR_TAGS);
  // Sub-projects follow their parent, indented.
  const sidebarProjects = projects.data?.flatMap((p) =>
    p.parentId && projects.data.some((o) => o.id === p.parentId) ? [] : [p, ...projects.data.filter((c) => c.parentId === p.id)],
  );

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
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 xl:w-62 2xl:w-68 flex-col gap-5 border-r border-line bg-surface px-3.5 py-5 md:flex">
        <div className="flex items-center gap-2.5 px-2">
          <Logo className="size-8" />
          <span className="font-display text-lg font-semibold">ProjectBench</span>
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {TABS.map((t) => {
            const current = t === active && !(t.path === '/projects' && (currentTag || projectMatch));
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
                {t.path === '/projects' ? 'All projects' : t.label}
                {t.path === '/projects' && !!projects.data?.length && <span className="ml-auto text-xs font-medium text-muted">{projects.data.length}</span>}
                {t.path === '/buy' && toBuy > 0 && <span className="ml-auto text-xs text-muted">{toBuy}</span>}
                {t.path === '/search' && (
                  <kbd className="ml-auto rounded border border-line px-1.5 py-0.5 font-sans text-[11px] font-medium text-muted">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
                )}
              </a>
            );
          })}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
          <nav aria-label="Projects" className="flex flex-col gap-0.5">
            <div className="flex items-center justify-between pr-1 pb-1 pl-2.5">
              <h2 className="text-xs font-semibold tracking-[0.06em] text-muted uppercase">Projects</h2>
              <button type="button" onClick={() => setCreating(true)} aria-label="New project" className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-ground">
                <PlusIcon width={16} height={16} />
              </button>
            </div>
            {sidebarProjects?.map((p) => {
              const to = `/projects/${p.id}`;
              const current = projectMatch?.[1] === p.id;
              const sub = p.parentId !== null && sidebarProjects.some((o) => o.id === p.parentId);
              return (
                <a
                  key={p.id}
                  href={to}
                  onClick={go(to)}
                  aria-current={current ? 'page' : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-sm ${sub ? 'min-h-9 pl-7' : 'min-h-10'} ${current ? 'bg-accent-soft font-semibold' : 'font-medium hover:bg-ground'}`}
                >
                  <ProjectTile project={p} size={sub ? 18 : 22} />
                  <span className="min-w-0 flex-1 truncate">{p.title}</span>
                  <span className="text-[11px] text-muted">{p.progress.total ? `${p.progress.done}/${p.progress.total}` : STATUS_META[p.status].label}</span>
                </a>
              );
            })}
          </nav>
          {!!tags.data?.length && (
            <nav aria-label="Tags" className="flex flex-wrap gap-1.5 px-2.5">
              <h2 className="w-full pb-1 text-xs font-semibold tracking-[0.06em] text-muted uppercase">Tags</h2>
              {sidebarTags?.map((t) => {
                const to = `/projects?tag=${encodeURIComponent(t.name)}`;
                const current = active?.path === '/projects' && !projectMatch && currentTag === t.name;
                return (
                  <a
                    key={t.name}
                    href={to}
                    onClick={go(to)}
                    aria-current={current ? 'page' : undefined}
                    className={`flex h-7 max-w-full items-center gap-1 rounded-full border px-2.5 text-xs ${
                      current ? 'border-accent bg-accent-soft font-semibold text-accent-ink' : 'border-line font-medium text-ink-soft hover:bg-ground'
                    }`}
                  >
                    <span className="truncate">#{t.name}</span>
                    <span className="text-muted">{t.projects}</span>
                  </a>
                );
              })}
              {tags.data.length > SIDEBAR_TAGS && (
                <button type="button" onClick={() => setAllTags(!allTags)} aria-expanded={allTags} className="h-7 rounded-full border border-line px-2.5 text-xs font-medium text-muted hover:bg-ground">
                  {allTags ? 'Show less' : `+${tags.data.length - SIDEBAR_TAGS} more`}
                </button>
              )}
            </nav>
          )}
        </div>
        <div className="mt-auto flex flex-col gap-1">
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
        {/* A project's header band runs full width, so it caps its own content. */}
        <div className={`mx-auto flex w-full flex-1 flex-col ${projectMatch ? '' : CONTENT_WIDTH}`}>{content}</div>

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

      {creating && (
        <NewProjectSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            navigate(`/projects/${id}?look`);
          }}
        />
      )}
    </div>
  );
}
