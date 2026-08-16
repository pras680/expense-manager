// registerType: 'autoUpdate' (vite.config.ts) makes a new service worker take
// control silently in the background, but never reloads the page that's
// already open — the tab keeps running whatever JS it already loaded.
//
// On Android that's rarely noticed: an installed PWA typically gets a fresh
// process on each open, so the new code loads without anyone doing anything.
// iOS instead suspends and resumes the *same* WKWebView process when you tap
// the home-screen icon, so without this listener a user could sit on
// months-old code indefinitely — that's the exact gap the user reported.
//
// controllerchange fires the moment the new worker takes over. Reloading then
// makes both platforms behave the same: pick up the update on next open, not
// "eventually, if the process happens to restart."
if ('serviceWorker' in navigator) {
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}
