// The app's switchable themes. The colours themselves live in index.css (one
// [data-theme="…"] block each); this file is the list the You page shows, and
// the code that applies and remembers the choice.
//
// The choice is stored per device (localStorage), not in user_settings: it's
// a display preference for this screen, and it has to be readable before
// sign-in so the sign-in page and the first paint already match.

export type ThemeId = 'midnight' | 'ember' | 'ocean' | 'orchid' | 'paper' | 'sorbet'
export type ThemeScheme = 'dark' | 'light'

export interface ThemeOption {
  id: ThemeId
  name: string
  scheme: ThemeScheme
  /** Preview swatch colours — must match the theme's block in index.css. */
  bg: string
  card: string
  accent: string
  ink: string
}

export const THEMES: ThemeOption[] = [
  { id: 'midnight', name: 'Midnight', scheme: 'dark', bg: '#0b0c10', card: '#15171d', accent: '#c8f53c', ink: '#f4f5f7' },
  { id: 'ember', name: 'Ember', scheme: 'dark', bg: '#120d0b', card: '#1d1613', accent: '#ff6a3d', ink: '#faf3ee' },
  { id: 'ocean', name: 'Ocean', scheme: 'dark', bg: '#07121f', card: '#0e1c2e', accent: '#4fe3d0', ink: '#eef4fa' },
  { id: 'orchid', name: 'Orchid', scheme: 'dark', bg: '#110c18', card: '#1a1424', accent: '#b99bff', ink: '#f6f1fb' },
  { id: 'paper', name: 'Paper', scheme: 'light', bg: '#f3f1eb', card: '#ffffff', accent: '#2b4bff', ink: '#15161a' },
  { id: 'sorbet', name: 'Sorbet', scheme: 'light', bg: '#fbf1ec', card: '#ffffff', accent: '#d93a22', ink: '#2a1a16' }
]

export const DEFAULT_THEME: ThemeId = 'midnight'
/** Also read by the inline script in index.html — keep the key in step. */
export const THEME_STORAGE_KEY = 'billskills.theme'

export function themeById(id: string | null | undefined): ThemeOption {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function readStoredTheme(): ThemeId {
  try {
    return themeById(window.localStorage.getItem(THEME_STORAGE_KEY)).id
  } catch {
    // Private-mode Safari can throw on storage access; the default still works.
    return DEFAULT_THEME
  }
}

/** Stamps the theme on <html> and keeps the browser chrome colour in step. */
export function applyTheme(id: ThemeId) {
  const theme = themeById(id)
  const root = document.documentElement
  root.dataset.theme = theme.id
  root.dataset.scheme = theme.scheme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg)
}

export function storeTheme(id: ThemeId) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id)
  } catch {
    // Not being able to remember the choice shouldn't stop it applying now.
  }
}
