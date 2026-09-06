import { NavLink, useLocation } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Home', icon: '\u{1F9FE}' },
  { to: '/add', label: 'Add', icon: '➕' },
  { to: '/reports', label: 'Reports', icon: '\u{1F4CA}' },
  { to: '/settings', label: 'Settings', icon: '⚙️' }
]

export function NavBar() {
  const { pathname } = useLocation()
  // The Home tab covers both the landing dashboard and the full receipts list
  // it links out to (/receipts, /receipts/:id/edit) — those aren't a tab of
  // their own, so without this the bar would show nothing active while
  // browsing or editing receipts.
  const homeIsActive = pathname === '/' || pathname.startsWith('/receipts')

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-20 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-4">
        {tabs.map((tab) => {
          const active = tab.to === '/' ? homeIsActive : pathname.startsWith(tab.to)
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-xs font-medium ${
                active ? 'text-accent-700 dark:text-accent-400' : 'text-neutral-500 dark:text-neutral-400'
              }`}
            >
              <span className="text-xl leading-none">{tab.icon}</span>
              {tab.label}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
