import { expect, test } from '@playwright/test'

test('overview renders on narrow screens and retains the publishing gate without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 740 } })
  const page = await context.newPage()
  await page.goto('http://localhost:8787/')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Your music,on Discord.')
  await expect(page.getByRole('heading', { name: 'Cloud publishing is still being verified.' })).toBeVisible()
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
  await page.getByRole('link', { name: 'View access probe' }).click()
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
