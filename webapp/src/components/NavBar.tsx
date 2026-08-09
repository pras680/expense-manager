import { NavLink } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Receipts', icon: '\u{1F9FE}' },
  { to: '/add', label: 'Add', icon: '➕' },
  { to: '/reports', label: 'Reports', icon: '\u{1F4CA}' },
  { to: '/settings', label: 'Settings', icon: '⚙️' }
]

export function NavBar() {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-4">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium ${
                isActive ? 'text-teal-700 dark:text-teal-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <span className="text-xl leading-none">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
