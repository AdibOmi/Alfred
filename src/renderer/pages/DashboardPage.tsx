import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Task } from '../api';
import type { Section } from '../ui/Sidebar';
import { ManualTrackersSection } from '../ui/ManualTrackersSection';
import { SearchPanel } from '../ui/SearchPanel';
import { useDevGlance } from '../ui/useDevGlance';
import { computeDailyStreak, formatDue, getUrgency, sortByDueThenCreated } from '../utils';
import { localDateString } from '../../shared/date';

interface DashboardPageProps {
  tasks: Task[];
  tasksLoading: boolean;
  onToggleDone: (task: Task) => void;
  onDelete: (id: string) => void;
  onNavigate: (section: Section) => void;
}

interface WidgetDef {
  title: string;
  span: 1 | 2 | 4;
  render: () => ReactElement;
}

interface LayoutEntry {
  id: string;
  visible: boolean;
}

const LAYOUT_KEY = 'alfred.dashboardLayout';
const DEFAULT_ORDER = ['briefing', 'agenda', 'deadlines', 'stats', 'dev-summary', 'priorities', 'manual-trackers', 'search'];

function loadLayout(): LayoutEntry[] {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    const saved: LayoutEntry[] = raw ? JSON.parse(raw) : [];
    const known = new Set(DEFAULT_ORDER);
    const kept = saved.filter((entry) => known.has(entry.id));
    const missing = DEFAULT_ORDER.filter((id) => !kept.some((entry) => entry.id === id));
    return [...kept, ...missing.map((id) => ({ id, visible: true }))];
  } catch {
    return DEFAULT_ORDER.map((id) => ({ id, visible: true }));
  }
}

function StatDial({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 360;
  return (
    <div className="stat-dial-tile">
      <div className="stat-dial" style={{ background: `conic-gradient(var(--accent) 0deg ${pct}deg, rgba(199, 203, 209, 0.1) ${pct}deg 360deg)` }}>
        <div className="stat-dial-inner">
          <strong>{value}</strong>
        </div>
      </div>
      <span className="stat-tile-label">{label}</span>
    </div>
  );
}

export function DashboardPage({ tasks, tasksLoading, onToggleDone, onDelete, onNavigate }: DashboardPageProps) {
  const [layout, setLayout] = useState<LayoutEntry[]>(loadLayout);
  const [customizing, setCustomizing] = useState(false);
  const devGlance = useDevGlance();

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  const move = (id: string, direction: -1 | 1) => {
    setLayout((prev) => {
      const index = prev.findIndex((entry) => entry.id === id);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggleVisible = (id: string) => {
    setLayout((prev) => prev.map((entry) => (entry.id === id ? { ...entry, visible: !entry.visible } : entry)));
  };

  const activeTasks = tasks.filter((t) => t.status === 'active');
  const deadlineTasks = sortByDueThenCreated(activeTasks.filter((t) => t.kind === 'deadline'));
  const datedDeadlines = deadlineTasks.filter((t): t is Task & { due: string } => t.due !== null);
  const priorityTasks = sortByDueThenCreated(activeTasks).slice(0, 5);

  const todayStr = localDateString();
  const todayTasks = sortByDueThenCreated(
    activeTasks.filter((t): t is Task & { due: string } => t.due !== null && localDateString(new Date(t.due)) === todayStr),
  );

  const githubStreak = useMemo(() => computeDailyStreak(devGlance.github?.dailyCommits ?? []), [devGlance.github]);
  const leetcodeStreak = devGlance.leetcode?.streak ?? 0;

  const briefingText = useMemo(() => {
    if (tasksLoading) return 'Reading the ledger…';
    const nearest = datedDeadlines[0];
    const parts: string[] = [];
    parts.push(`${activeTasks.length} active task${activeTasks.length === 1 ? '' : 's'}`);
    if (nearest) {
      const urgency = getUrgency(nearest.due);
      const label = urgency === 'overdue' ? 'overdue' : `due ${formatDue(nearest.due)}`;
      parts.push(`nearest deadline "${nearest.title}" ${label}`);
    }
    if (devGlance.githubTracker) parts.push(`GitHub streak at ${githubStreak}d`);
    if (devGlance.leetcodeTracker) parts.push(`LeetCode streak at ${leetcodeStreak}d`);
    return `${parts.join('. ')}.`;
  }, [tasksLoading, activeTasks.length, datedDeadlines, devGlance.githubTracker, devGlance.leetcodeTracker, githubStreak, leetcodeStreak]);

  const widgets: Record<string, WidgetDef> = {
    briefing: {
      title: 'Alfred Briefing',
      span: 4,
      render: () => (
        <div className="briefing-widget">
          <p className="briefing-text">{briefingText}</p>
        </div>
      ),
    },
    agenda: {
      title: "Today's Agenda",
      span: 2,
      render: () => (
        <>
          {todayTasks.length === 0 ? (
            <p className="hint-text">Nothing on the books for today.</p>
          ) : (
            <div className="task-list">
              {todayTasks.map((task) => (
                <div key={task.id} className={`task-card urgency-${getUrgency(task.due)}`}>
                  <label className="task-check">
                    <input type="checkbox" checked={false} onChange={() => onToggleDone(task)} />
                    <span>{task.title}</span>
                    <span className="tracker-type-badge">{task.kind}</span>
                  </label>
                  <div className="task-meta">
                    <small>{formatDue(task.due)}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="hint-text" style={{ marginTop: 10 }}>
            Connect Google Calendar to fold in today&apos;s events here too — coming in a later update.
          </p>
        </>
      ),
    },
    deadlines: {
      title: 'Deadline Countdown',
      span: 2,
      render: () =>
        deadlineTasks.length === 0 ? (
          <p className="hint-text">Nothing on the horizon.</p>
        ) : (
          <div className="task-list">
            {deadlineTasks.slice(0, 5).map((task) => (
              <div key={task.id} className={`task-card ${task.due ? `urgency-${getUrgency(task.due)}` : ''}`}>
                <label className="task-check">
                  <input type="checkbox" checked={false} onChange={() => onToggleDone(task)} />
                  <span>{task.title}</span>
                </label>
                <div className="task-meta">
                  {task.due && <small>{formatDue(task.due)}</small>}
                  <button className="ghost-button icon-button" onClick={() => onDelete(task.id)} aria-label="Delete task">
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ),
    },
    stats: {
      title: 'Quick Stats',
      span: 4,
      render: () => (
        <div className="stat-strip-grid">
          <div className="stat-tile">
            <strong>—</strong>
            <span>Unread mail</span>
          </div>
          <div className="stat-tile">
            <strong>{activeTasks.length}</strong>
            <span>Active tasks</span>
          </div>
          <StatDial label="GitHub streak" value={devGlance.githubTracker ? `${githubStreak}d` : '—'} ratio={githubStreak / 30} />
          <StatDial label="LeetCode streak" value={devGlance.leetcodeTracker ? `${leetcodeStreak}d` : '—'} ratio={leetcodeStreak / 30} />
        </div>
      ),
    },
    'dev-summary': {
      title: 'Coding Log',
      span: 2,
      render: () => (
        <>
          <div className="dev-summary-row">
            <div className="stat-tile">
              <strong>{devGlance.github?.totals?.commits ?? 0}</strong>
              <span>GH commits</span>
            </div>
            <div className="stat-tile">
              <strong>{devGlance.leetcode?.difficulty?.total ?? 0}</strong>
              <span>LC solved</span>
            </div>
          </div>
          <button className="ghost-button" onClick={() => onNavigate('coding-log')}>
            View coding log →
          </button>
        </>
      ),
    },
    priorities: {
      title: 'Top Priorities',
      span: 2,
      render: () =>
        priorityTasks.length === 0 ? (
          <p className="hint-text">Nothing on the list.</p>
        ) : (
          <ol className="priority-list">
            {priorityTasks.map((task, index) => (
              <li key={task.id}>
                <span className="priority-index">{index + 1}.</span>
                <span>{task.title}</span>
              </li>
            ))}
          </ol>
        ),
    },
    'manual-trackers': {
      title: 'Manual Trackers',
      span: 4,
      render: () => <ManualTrackersSection />,
    },
    search: {
      title: 'File Search',
      span: 4,
      render: () => <SearchPanel />,
    },
  };

  const visibleLayout = layout.filter((entry) => customizing || entry.visible);

  return (
    <>
      <div className="page-header">
        <p className="eyebrow">Command</p>
        <h2>Dashboard</h2>
      </div>
      <div className="dashboard-toolbar">
        <button className="ghost-button" onClick={() => setCustomizing((v) => !v)}>
          {customizing ? 'Done customizing' : 'Customize'}
        </button>
      </div>
      <div className="widget-grid">
        {visibleLayout.map((entry, index) => {
          const def = widgets[entry.id];
          if (!def) return null;
          return (
            <section
              key={entry.id}
              className={`panel widget widget-span-${def.span} ${!entry.visible ? 'hidden-widget' : ''}`}
            >
              <div className="widget-header">
                <h3>{def.title}</h3>
                {customizing && (
                  <div className="widget-move-controls">
                    <button className="ghost-button icon-button" onClick={() => move(entry.id, -1)} disabled={index === 0} aria-label="Move earlier">
                      ↑
                    </button>
                    <button
                      className="ghost-button icon-button"
                      onClick={() => move(entry.id, 1)}
                      disabled={index === visibleLayout.length - 1}
                      aria-label="Move later"
                    >
                      ↓
                    </button>
                    <button className="ghost-button icon-button" onClick={() => toggleVisible(entry.id)} aria-label="Toggle visibility">
                      {entry.visible ? '👁' : '🚫'}
                    </button>
                  </div>
                )}
              </div>
              {def.render()}
            </section>
          );
        })}
      </div>
    </>
  );
}
