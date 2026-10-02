import { useRef, useState, type ReactNode } from 'react';

type Tab = { id: string; label: string; content: ReactNode };

const hashTab = (tabs: Tab[]) => {
  const id = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return tabs.some(tab => tab.id === id) ? id : tabs[0]!.id;
};

/**
 * The game page's sections, one tab at a time so a phone isn't one long
 * scroll. A tab mounts the first time it is opened and stays mounted, and the
 * open tab is kept in the URL hash so a shared link opens it. Key it by game
 * so moving to another game starts fresh.
 */
export function GameTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(() => hashTab(tabs));
  const [opened, setOpened] = useState(() => new Set([active]));
  const bar = useRef<HTMLDivElement>(null);
  const current = tabs.some(tab => tab.id === active) ? active : tabs[0]!.id;
  const choose = (id: string) => {
    setActive(id);
    setOpened(previous => new Set(previous).add(id));
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}#${id}`);
    const top = bar.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 0) bar.current?.scrollIntoView({ block: 'start' });
  };
  return <div className="gl-game-tabs">
    <div ref={bar} className="gl-tabbar" role="tablist" aria-label="Game details">
      {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`game-tab-${tab.id}`}
        aria-selected={tab.id === current} aria-controls={`game-panel-${tab.id}`} tabIndex={tab.id === current ? 0 : -1}
        onClick={() => choose(tab.id)}
        onKeyDown={event => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          const index = tabs.findIndex(item => item.id === current);
          const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]!;
          choose(next.id);
          document.getElementById(`game-tab-${next.id}`)?.focus();
        }}>{tab.label}</button>)}
    </div>
    {tabs.filter(tab => opened.has(tab.id) || tab.id === current).map(tab =>
      <div key={tab.id} id={`game-panel-${tab.id}`} role="tabpanel" aria-labelledby={`game-tab-${tab.id}`}
        className="gl-tabpanel" hidden={tab.id !== current}>{tab.content}</div>)}
  </div>;
}
