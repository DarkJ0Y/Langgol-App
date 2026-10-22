/* Shared by the 3D scenes and the page: theme colours, motion preference, visibility. */

const listeners = new Set()

export function palette() {
  const css = getComputedStyle(document.documentElement)
  const v = (name) => css.getPropertyValue(name).trim()
  return {
    dark: document.documentElement.dataset.theme !== 'light',
    bg: v('--bg'),
    surface: v('--surface'),
    line: v('--line'),
    text: v('--text'),
    text3: v('--text-3'),
    fill: v('--fill'),
    viz: [v('--viz-1'), v('--viz-2'), v('--viz-3'), v('--viz-4')],
  }
}

export function onThemeChange(fn) {
  listeners.add(fn)
}

export function setTheme(theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem('langgol-portfolio-theme', theme)
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
  listeners.forEach((fn) => fn())
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Runs `frame` every animation frame, but only while the canvas is on screen and the tab is
 * visible. Two WebGL scenes on one page would otherwise keep the GPU busy the whole visit.
 */
export function whenVisible(canvas, renderer, frame) {
  let onScreen = false
  const update = () => renderer.setAnimationLoop(onScreen && !document.hidden ? frame : null)
  new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting
      update()
    },
    { rootMargin: '100px' },
  ).observe(canvas)
  document.addEventListener('visibilitychange', update)
}
