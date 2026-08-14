import type { ReactElement } from 'react';

export type Section = 'dashboard' | 'coding-log' | 'todos' | 'finance' | 'gym' | 'settings';

interface NavEntry {
  id: Section;
  label: string;
  icon: ReactElement;
}

const iconProps = {
  viewBox: '0 0 24 24',
  className: 'nav-icon',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const NAV_ITEMS: NavEntry[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: 'coding-log',
    label: 'Coding Log',
    icon: (
      <svg {...iconProps}>
        <polyline points="8 6 3 12 8 18" />
        <polyline points="16 6 21 12 16 18" />
      </svg>
    ),
  },
  {
    id: 'todos',
    label: 'Todos / Deadlines',
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="4" width="18" height="16" rx="1" />
        <polyline points="7 12 10 15 17 8" />
      </svg>
    ),
  },
  {
    id: 'finance',
    label: 'Finance',
    icon: (
      <svg {...iconProps}>
        <line x1="4" y1="20" x2="4" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="20" y1="20" x2="20" y2="14" />
      </svg>
    ),
  },
  {
    id: 'gym',
    label: 'Training Log',
    icon: (
      <svg {...iconProps}>
        <rect x="2" y="9" width="3" height="6" />
        <rect x="19" y="9" width="3" height="6" />
        <rect x="5" y="7" width="2" height="10" />
        <rect x="17" y="7" width="2" height="10" />
        <line x1="7" y1="12" x2="17" y2="12" />
      </svg>
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg {...iconProps}>
        <circle cx="12" cy="12" r="3" />
        <line x1="12" y1="2" x2="12" y2="5" />
        <line x1="12" y1="19" x2="12" y2="22" />
        <line x1="2" y1="12" x2="5" y2="12" />
        <line x1="19" y1="12" x2="22" y2="12" />
        <line x1="4.9" y1="4.9" x2="7" y2="7" />
        <line x1="17" y1="17" x2="19.1" y2="19.1" />
        <line x1="4.9" y1="19.1" x2="7" y2="17" />
        <line x1="17" y1="7" x2="19.1" y2="4.9" />
      </svg>
    ),
  },
];

interface SidebarProps {
  active: Section;
  onSelect: (section: Section) => void;
}

export function Sidebar({ active, onSelect }: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="sidebar-brand">◆ Alfred</div>
      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`nav-item ${active === item.id ? 'active' : ''}`}
            onClick={() => onSelect(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
