import { expect, test } from '@playwright/test'
import { defaultMusicPreferences } from '../../src/lib/music-preferences'
import type { AccountView } from '../../src/lib/account'
import type { PlatformStatistics } from '../../src/lib/platform-statistics'

test('minimal sign-in works on narrow screens without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 740 } })
  const page = await context.newPage()
  await page.goto('http://localhost:8787/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your music, on Discord.')
  await expect(page.getByRole('button', { name: 'Log in with Discord' })).toBeEnabled()
  await expect(page.locator('form[action="/auth/discord/start"]')).toHaveAttribute('method', 'post')
  await expect(page.getByRole('navigation')).toHaveCount(0)
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflows).toBe(false)
  await context.close()
})

test('theme and fonts work under the production CSP and preference survives reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.goto('/')
  await page.getByRole('button', { name: 'Use light theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Use dark theme' })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.fonts.check('16px "Overused Grotesk"'))).toBe(true)
  expect(errors).toEqual([])
})

test('sign-in shows a single action and Last.fm linking appears only after Discord sign-in', async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ status: 401, json: { enabled: true, account: null } }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Log in with Discord' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Connect Last.fm' })).toHaveCount(0)
  await expect(page.locator('form[action="/auth/discord/start"]')).toHaveAttribute('method', 'post')
  await page.unroute('**/api/account')
  await page.route('**/api/account', route => route.fulfill({ json: { enabled: true, account: { userId: '234567890123456789', enabled: true, status: 'link_lastfm', connected: false, track: null } } }))
  await page.goto('/app')
  await expect(page.getByRole('button', { name: 'Connect Last.fm' })).toBeEnabled()
  await expect(page.locator('form[action="/auth/lastfm/start"]')).toHaveAttribute('method', 'post')
  await expect(page.getByRole('button', { name: 'Log in with Discord' })).toHaveCount(0)
})

test('the account dashboard shows music, pause controls, and safe authorization errors on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.route('**/api/account', route => route.fulfill({ json: { enabled: true, account: { userId: '234567890123456789', lastfmUsername: 'twangodev', enabled: true, status: 'listening', connected: true, track: { title: 'Everything In Its Right Place', artist: 'Radiohead', album: 'Kid A' } } } }))
  await page.goto('/app?error=lastfm_authorization_failed')
  await expect(page.getByRole('status')).toHaveText('Sharing your music')
  await expect(page.getByText('Everything In Its Right Place', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause sharing' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveText('Last.fm could not be connected. Please try again.')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.goto('/app?error=lastfm_authorization_incomplete')
  await expect(page.getByRole('alert')).toHaveText('Last.fm did not return a usable authorization token. Please start again.')
})

test('account provider redirects are allowed by the effective production content security policy', async ({ page }) => {
  await page.goto('/app')
  const policy = await page.locator('meta[http-equiv="content-security-policy" i]').getAttribute('content')
  expect(policy).toMatch(/form-action[^;]+https:\/\/discord\.com/)
  expect(policy).toMatch(/form-action[^;]+https:\/\/www\.last\.fm/)
  expect(policy).toMatch(/img-src[^;]+https:\/\/lastfm-img\.freetls\.fastly\.net/)
})

test('native account forms preserve the origin required by the Worker', async ({ page }) => {
  const linkedAccount = { userId: '234567890123456789', lastfmUsername: 'twangodev', enabled: true, status: 'idle', connected: false, track: null }
  const actions = [
    { button: 'Log in with Discord', path: '/auth/discord/start', account: null },
    { button: 'Connect Last.fm', path: '/auth/lastfm/start', account: { ...linkedAccount, lastfmUsername: undefined, status: 'link_lastfm' } },
    { button: 'Pause sharing', path: '/api/account/pause', account: linkedAccount },
    { button: 'Resume sharing', path: '/api/account/resume', account: { ...linkedAccount, enabled: false, status: 'paused' } },
    { button: 'Sign out', path: '/api/account/logout', account: linkedAccount },
    { button: 'Disconnect accounts', path: '/api/account/disconnect', account: linkedAccount },
  ]
  for (const action of actions) {
    await page.route('**/api/account', route => route.fulfill({ json: { enabled: true, account: action.account } }))
    let sentOrigin: string | undefined
    await page.route(`**${action.path}`, async route => {
      expect(route.request().method()).toBe('POST')
      sentOrigin = route.request().headers().origin
      await route.fulfill({ contentType: 'text/html', body: '<h1>Account action received</h1>' })
    })
    await page.goto('/app')
    if (['Sign out', 'Disconnect accounts'].includes(action.button)) await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('button', { name: action.button, exact: true }).click()
    await expect(page).toHaveURL(`http://localhost:8787${action.path}`)
    await expect(page.getByRole('heading')).toHaveText('Account action received')
    expect(sentOrigin, action.path).toBe('http://localhost:8787')
    await page.unroute('**/api/account')
  }
})

test('presence preferences submit all CLI controls with the native browser origin and preserve unsaved edits during refresh', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.clock.install()
  const account = { userId: '234567890123456789', lastfmUsername: 'twangodev', enabled: true, status: 'idle', connected: false, track: null, preferences: defaultMusicPreferences }
  let refreshes = 0
  await page.route('**/api/account', route => { refreshes++; return route.fulfill({ json: { enabled: true, account } }) })
  await page.route('**/api/account/preferences', async route => {
    expect(route.request().method()).toBe('POST')
    expect(route.request().headers().origin).toBe('http://localhost:8787')
    const preferences = Object.fromEntries(new URLSearchParams(route.request().postData()!))
    expect(preferences).toEqual({ refreshInterval: '30', statusDisplay: 'artist', showLoved: 'on', keepStatus: 'on', debug: 'on' })
    await route.fulfill({ contentType: 'text/html', body: '<h1>Preferences received</h1>' })
  })
  await page.goto('/app')
  await expect(page.getByRole('form', { name: 'Presence preferences' })).not.toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByLabel('Show profile button')).toBeChecked()
  await expect(page.getByLabel('Show loved-track heart')).not.toBeChecked()
  await expect(page.getByLabel('Refresh interval (seconds)')).toHaveValue('10')
  const listeningStatus = page.getByRole('button', { name: 'Listening status', exact: true })
  await expect(listeningStatus).toHaveText('Song title')
  await listeningStatus.focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(listeningStatus).toHaveText('Artist')
  await expect(listeningStatus).toBeFocused()
  for (const label of ['Show profile button', 'Show album covers', 'Show elapsed time']) await page.getByLabel(label).uncheck()
  for (const label of ['Show loved-track heart', 'Keep status when idle', 'Show sync diagnostics']) await page.getByLabel(label).check()
  await page.getByLabel('Refresh interval (seconds)').fill('30')
  await page.clock.runFor(10_000)
  await expect.poll(() => refreshes).toBeGreaterThan(1)
  await expect(page.getByLabel('Refresh interval (seconds)')).toHaveValue('30')
  await expect(listeningStatus).toHaveText('Artist')
  await expect(page.getByLabel('Show loved-track heart')).toBeChecked()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(listeningStatus).toHaveText('Artist')
  await listeningStatus.click()
  await expect(page.getByRole('option', { name: 'Artist', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(listeningStatus).toBeFocused()
  await page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(page).toHaveURL('http://localhost:8787/api/account/preferences')
  await expect(page.getByRole('heading')).toHaveText('Preferences received')
})

test('activity preview shows loved tracks, elapsed time and profile controls with safe diagnostics', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const startedAt = Date.now() - 65_000
  const artwork = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/browser-test.png'
  await page.route(artwork, route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64') }))
  const account: AccountView = { userId: '234567890123456789', lastfmUsername: 'twangodev', enabled: true, status: 'listening', connected: true,
    track: { title: 'Kid A', artist: 'Radiohead', album: 'Kid A', artwork, loved: true, startedAt },
    preferences: { ...defaultMusicPreferences, showLoved: true, showProfile: false, debug: true }, consecutiveFailures: 0,
    lastCheckedAt: startedAt + 60_000, events: [{ at: startedAt, event: 'published' }] }
  await page.route('**/api/account', route => route.fulfill({ json: { enabled: true, account } }))
  await page.goto('/app?saved=preferences')
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved.' })).toBeVisible()
  await expect(page.getByText('Loved on Last.fm', { exact: true })).toBeVisible()
  await expect(page.getByText('Listening to Kid A', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Kid A', exact: true })).toBeVisible()
  await expect.poll(() => page.getByRole('img', { name: 'Kid A', exact: true }).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(page.getByText(/1:0\d elapsed/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Last.fm profile' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'View track' })).toHaveAttribute('href', 'https://www.last.fm/music/Radiohead/_/Kid%20A')
  await expect(page.getByRole('heading', { name: 'Sync diagnostics' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Recent sync events' })).toContainText('Activity sent')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  account.preferences = { ...account.preferences, statusDisplay: 'artist' }
  await page.reload()
  await expect(page.getByText('Listening to Radiohead', { exact: true })).toBeVisible()
  account.status = 'idle'
  account.track = null
  account.preferences = { ...account.preferences, keepStatus: true }
  await page.reload()
  await expect(page.getByText('Playing Last.fm')).toBeVisible()
  await expect(page.getByRole('link', { name: 'View track' })).toHaveCount(0)
})

test('platform statistics refresh without a login, distinguish unknown totals, and retain the last sample during failures', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  const statistics: PlatformStatistics = { members: 42, sharingNow: 2, lastfmAccounts: 40, scrobbles: null, scrobblesUpdatedAt: null, sampledAt: Date.now() }
  let failure = false
  let malformed = false
  await page.route('**/api/account', route => route.fulfill({ status: 401, json: { enabled: true, account: null } }))
  await page.route('**/api/stats', route => route.fulfill({ status: failure ? 503 : 200, json: failure || malformed ? { error: 'statistics_unavailable' } : statistics }))
  await page.goto('/')
  const region = page.getByRole('region', { name: 'Platform statistics' })
  const counters = region.getByRole('definition')
  const expectCounts = async (values: string[]) => {
    await expect(counters).toHaveCount(values.length)
    for (const [index, value] of values.entries()) await expect(counters.nth(index).locator('.sr-only')).toHaveText(value)
  }
  await expectCounts(['42', '2', 'Not yet available'])
  await expect(region.getByText('Updating Last.fm totals…')).toBeVisible()
  statistics.members = 43
  statistics.sharingNow = 1
  statistics.scrobbles = 12345
  statistics.scrobblesUpdatedAt = Date.now()
  await page.clock.runFor(30_000)
  await expectCounts(['43', '1', '12,345'])
  await expect(region.locator('dd').last()).toHaveAttribute('title', '12,345')
  await expect.poll(() => region.locator('number-flow-svelte').first().evaluate(element => element.shadowRoot?.getAnimations().filter(animation => animation.playState === 'running').length ?? 0)).toBe(0)
  statistics.sampledAt = statistics.scrobblesUpdatedAt + 7 * 60_000
  await page.clock.runFor(30_000)
  await expect(region.getByText('Last.fm totals are waiting for an update.')).toBeVisible()
  for (const mode of ['failure', 'malformed']) {
    failure = mode === 'failure'
    malformed = mode === 'malformed'
    await page.clock.runFor(30_000)
    await expect(region.getByText('Statistics temporarily unavailable.')).toBeVisible()
    await expectCounts(['43', '1', '12,345'])
  }
  await expect(page.getByRole('button', { name: 'Log in with Discord' })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})
