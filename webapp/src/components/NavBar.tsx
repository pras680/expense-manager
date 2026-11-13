import { NavLink, useLocation } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/reports', label: 'Insights', icon: 'chart' },
  { to: '/add', label: 'Add', icon: 'plus' },
  { to: '/receipts', label: 'Receipts', icon: 'receipt' },
  { to: '/settings', label: 'You', icon: 'user' }
]

/** Height the page content has to clear: the bar itself plus its bottom gap. */
export const NAV_CLEARANCE = 'calc(5.75rem + env(safe-area-inset-bottom))'

export function NavBar() {
  const { pathname } = useLocation()

  return (
    <nav
      aria-label="Main"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-3"
      style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
    >
      {/* A floating pill rather than an edge-to-edge bar: the page scrolls
          visibly behind it, and on a wide screen it stays phone-width instead
          of stretching five icons across a desktop. */}
      <div className="pointer-events-auto mx-auto grid h-16 max-w-md grid-cols-5 items-center rounded-full border border-line bg-card/90 px-1.5 shadow-lg shadow-black/20 backdrop-blur-md">
        {TABS.map((tab) => {
          const active = tab.to === '/' ? pathname === '/' : pathname.startsWith(tab.to)
          if (tab.to === '/add') {
            return (
              <NavLink key={tab.to} to={tab.to} aria-label="Add" className="flex h-full items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-on-accent transition-transform active:scale-95">
                  <Icon name="plus" size={24} strokeWidth={2.4} />
                </span>
              </NavLink>
            )
          }
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              data-active={active}
              className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                active ? 'text-ink' : 'text-muted'
              }`}
            >
              <span className={`flex h-7 w-12 items-center justify-center rounded-full ${active ? 'bg-card-2' : ''}`}>
                <Icon name={tab.icon} size={20} />
              </span>
              {tab.label}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
