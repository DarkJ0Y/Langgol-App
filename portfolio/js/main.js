import { initCharts } from './charts.js'
import { onThemeChange, setTheme } from './theme.js'

/* ---- theme switch */
const toggle = document.getElementById('theme-toggle')
function labelToggle() {
  const dark = document.documentElement.dataset.theme !== 'light'
  toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode')
}
toggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
})
onThemeChange(labelToggle)
labelToggle()

/* ---- product tour tabs (arrow keys move between tabs, as the ARIA pattern expects) */
for (const tour of document.querySelectorAll('[data-tour]')) {
  const tabs = [...tour.querySelectorAll('[role="tab"]')]
  const select = (tab) => {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on
    }
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (e) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
      if (!step) return
      e.preventDefault()
      const next = tabs[(i + step + tabs.length) % tabs.length]
      select(next)
      next.focus()
    })
  })
}

/* ---- charts */
initCharts()

/* ---- 3D: loaded last and separately, so a failure here never takes the page with it */
function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

if (webglAvailable()) {
  import('./hero.js')
    .then(({ initHero }) => initHero(document.getElementById('hero-canvas')))
    .catch((error) => console.warn('Hero scene unavailable:', error))

  import('./flow.js')
    .then(({ initFlow }) =>
      initFlow(
        document.getElementById('flow-canvas'),
        [...document.querySelectorAll('.how__steps .step')],
        document.getElementById('flow-caption'),
      ),
    )
    .catch((error) => console.warn('Flow scene unavailable:', error))
} else {
  document.documentElement.classList.add('no-webgl')
}
