import { describe, expect, it } from 'vitest'
import { sitePasswordAccepted } from './site-password'

/** What a browser sends: base64 of the UTF-8 bytes of "user:password". */
function basic(credentials: string): string {
  const bytes = new TextEncoder().encode(credentials)
  return `Basic ${btoa(String.fromCharCode(...bytes))}`
}

describe('the site password gate', () => {
  it('lets the right password in, whatever the user name', () => {
    expect(sitePasswordAccepted(basic('anyone:LanggolDemo2026'), 'LanggolDemo2026')).toBe(true)
    expect(sitePasswordAccepted(basic(':LanggolDemo2026'), 'LanggolDemo2026')).toBe(true)
  })

  it('keeps a wrong, longer or shorter password out', () => {
    expect(sitePasswordAccepted(basic('a:LanggolDemo2025'), 'LanggolDemo2026')).toBe(false)
    expect(sitePasswordAccepted(basic('a:LanggolDemo20266'), 'LanggolDemo2026')).toBe(false)
    expect(sitePasswordAccepted(basic('a:Langgol'), 'LanggolDemo2026')).toBe(false)
    expect(sitePasswordAccepted(basic('a:'), 'LanggolDemo2026')).toBe(false)
  })

  it('accepts a password containing a colon: only the first colon separates the user name', () => {
    expect(sitePasswordAccepted(basic('a:pass:word12'), 'pass:word12')).toBe(true)
  })

  it('compares bytes, so a Bangla password works', () => {
    expect(sitePasswordAccepted(basic('a:লাঙ্গল২০২৬'), 'লাঙ্গল২০২৬')).toBe(true)
    expect(sitePasswordAccepted(basic('a:লাঙ্গল২০২৫'), 'লাঙ্গল২০২৬')).toBe(false)
  })

  it('refuses anything that is not Basic credentials', () => {
    expect(sitePasswordAccepted(null, 'LanggolDemo2026')).toBe(false)
    expect(sitePasswordAccepted('Bearer abc', 'LanggolDemo2026')).toBe(false)
    expect(sitePasswordAccepted('Basic !!!not-base64!!!', 'LanggolDemo2026')).toBe(false)
    expect(sitePasswordAccepted(`Basic ${btoa('no-colon-here')}`, 'LanggolDemo2026')).toBe(false)
  })
})
