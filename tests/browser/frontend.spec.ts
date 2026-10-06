import { expect, test } from '@playwright/test'

test('overview renders on narrow screens and explains cloud sharing without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 740 } })
  const page = await context.newPage()
  await page.goto('http://localhost:8787/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your music,on Discord.')
  await expect(page.getByRole('heading', { name: 'Your music keeps going. So do we.' })).toBeVisible()
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflows).toBe(false)
  await page.goto('http://localhost:8787/probe')
  await expect(page.getByRole('button', { name: 'Continue to Discord' })).toBeDisabled()
  await expect(page.getByText('JavaScript is required')).toBeVisible()
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
  await page.getByRole('link', { name: 'Access probe' }).click()
  await expect(page.getByRole('status')).toHaveText('Probe disabled')
  await expect(page.getByRole('button', { name: 'Continue to Discord' })).toBeDisabled()
  expect(errors).toEqual([])
})

for (const [state, label] of [['disabled', 'Probe disabled'], ['unconfigured', 'Setup required'], ['ready', 'Ready for a test']] as const) {
  test(`probe only permits form interaction when readiness is ${state}`, async ({ page }) => {
    await page.route('**/api/probe', route => route.fulfill({ json: { state, publication: 'not_tested' } }))
    await page.goto('/probe')
    await expect(page.getByRole('status')).toHaveText(label)
    const key = page.getByLabel('Operator access key')
    const submit = page.getByRole('button', { name: 'Continue to Discord' })
    const presence = page.getByLabel('Publish a 45-second test activity')
    if (state === 'ready') {
      await expect(key).toBeEnabled()
      await expect(submit).toBeEnabled()
      await expect(presence).toBeEnabled()
      await expect(presence).not.toBeChecked()
      await expect(key).toHaveAttribute('type', 'password')
      await expect(page.locator('form')).toHaveAttribute('method', 'post')
      await expect(page.locator('form')).toHaveAttribute('action', '/probe/start')
    } else {
      await expect(key).toBeDisabled()
      await expect(submit).toBeDisabled()
      await expect(presence).toBeDisabled()
    }
  })
}

test('unavailable or malformed readiness responses keep the probe closed', async ({ page }) => {
  for (const response of [{ status: 503, json: { error: 'unavailable' } }, { json: { state: 'ready', publication: 'verified' } }]) {
    await page.route('**/api/probe', route => route.fulfill(response))
    await page.goto('/probe')
    await expect(page.getByRole('status')).toHaveText('Status unavailable')
    await expect(page.getByLabel('Operator access key')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Continue to Discord' })).toBeDisabled()
    await page.unroute('**/api/probe')
  }
})

for (const publish of [false, true]) {
  test(`native form submits the key and presence choice ${publish} directly to the same-origin Worker`, async ({ page }) => {
    const key = 'browser-test-key-only'
    await page.route('**/api/probe', route => route.fulfill({ json: { state: 'ready', publication: 'not_tested' } }))
    await page.route('**/probe/start', async route => {
      const request = route.request()
      expect(request.method()).toBe('POST')
      expect(request.headers().origin).toBe('http://localhost:8787')
      expect(new URLSearchParams(request.postData()!).get('access_key')).toBe(key)
      expect(new URLSearchParams(request.postData()!).get('experiment')).toBe(publish ? 'presence' : null)
      await route.fulfill({ contentType: 'text/html', body: '<h1>Mock probe start</h1>' })
    })
    await page.goto('/probe')
    await expect(page.getByRole('status')).toHaveText('Ready for a test')
    await page.getByLabel('Operator access key').fill(key)
    if (publish) await page.getByLabel('Publish a 45-second test activity').check()
    expect(await page.evaluate(() => localStorage.getItem('access_key'))).toBeNull()
    await page.getByRole('button', { name: 'Continue to Discord' }).click()
    await expect(page).toHaveURL('http://localhost:8787/probe/start')
    await expect(page.getByRole('heading', { name: 'Mock probe start' })).toBeVisible()
  })
}


test('account linking uses native forms and only enables Last.fm after Discord sign-in', async ({ page }) => {
  await page.route('**/api/account', route => route.fulfill({ status: 401, json: { enabled: true, account: null } }))
  await page.goto('/app')
  await expect(page.getByRole('button', { name: 'Connect Discord' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Connect Last.fm' })).toBeDisabled()
  await expect(page.locator('form[action="/auth/discord/start"]')).toHaveAttribute('method', 'post')
  await page.unroute('**/api/account')
  await page.route('**/api/account', route => route.fulfill({ json: { enabled: true, account: { userId: '234567890123456789', enabled: true, status: 'link_lastfm', connected: false, track: null } } }))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Connect Last.fm' })).toBeEnabled()
  await expect(page.locator('form[action="/auth/lastfm/start"]')).toHaveAttribute('method', 'post')
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
})

test('native account forms preserve the origin required by the Worker', async ({ page }) => {
  const linkedAccount = { userId: '234567890123456789', lastfmUsername: 'twangodev', enabled: true, status: 'idle', connected: false, track: null }
  const actions = [
    { button: 'Connect Discord', path: '/auth/discord/start', account: null },
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
    await page.getByRole('button', { name: action.button, exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Account action received' })).toBeVisible()
    expect(sentOrigin, action.path).toBe('http://localhost:8787')
    await page.unroute('**/api/account')
  }
})
