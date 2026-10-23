import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const api = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:8000'
async function localValue(page: Page, instant: number) {
  return page.evaluate((time) => {
    const date = new Date(time)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }, instant)
}
test('real buyer and supplier journey, server rejection, mobile and keyboard', async ({
  page,
  request,
}, testInfo) => {
  const exceptions: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => exceptions.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const health = await request.get(`${api}/health`)
  expect(health.ok(), 'Start the configured local backend before this test').toBeTruthy()
  const serverNow = Date.parse((await health.json()).server_now)
  const reference = `BROWSER-${Date.now()}`
  const name = `Regional freight ${reference}`
  await page.goto('/')
  await expect(page.locator('.auction-table tbody tr').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('listing-desktop.png'), fullPage: true })
  await page.getByRole('link', { name: 'Create RFQ', exact: true }).last().click()
  await expect(page.getByRole('heading', { name: 'Create RFQ' })).toBeVisible()
  await page.getByLabel('RFQ name', { exact: true }).fill(name)
  await page.getByLabel('Reference ID', { exact: true }).fill(reference)
  await page
    .getByLabel('Bid start', { exact: true })
    .fill(await localValue(page, serverNow - 60000))
  await page
    .getByLabel('Initial close', { exact: true })
    .fill(await localValue(page, serverNow + 120000))
  await page
    .getByLabel('Forced close', { exact: true })
    .fill(await localValue(page, serverNow + 1200000))
  const pickup = new Date(serverNow + 86400000).toISOString().slice(0, 10)
  await page.getByLabel('Pickup / service date', { exact: true }).fill(pickup)
  await page.getByLabel('Closing window · X minutes', { exact: true }).fill('30')
  await page.getByLabel('Extend by · Y minutes', { exact: true }).fill('3')
  await page.screenshot({ path: testInfo.outputPath('create-desktop.png'), fullPage: true })
  await page.getByRole('button', { name: 'Create RFQ', exact: true }).click()
  await expect(page).toHaveURL(/\/rfqs\/\d+$/)
  const id = page.url().split('/').pop()!
  const created = await (await request.get(`${api}/rfqs/${id}`)).json()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const select = page.getByLabel('Supplier', { exact: true })
  await select.selectOption('1')
  await page.getByLabel('Carrier name', { exact: true }).fill('Browser carrier')
  await page.getByLabel('Freight charges (INR)', { exact: true }).fill('100.00')
  await page.getByLabel('Origin charges (INR)', { exact: true }).fill('20.00')
  await page.getByLabel('Destination charges (INR)', { exact: true }).fill('10.00')
  await expect(page.getByTestId('quote-total')).toHaveText('₹130.00')
  await page.getByRole('button', { name: 'Submit quote', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Bid #' })).toContainText(
    'accepted at ₹130.00',
  )
  await expect(page.getByRole('region', { name: 'Supplier rankings' })).toContainText(
    'Atlas Logistics',
  )
  const afterFirst = await (await request.get(`${api}/rfqs/${id}`)).json()
  expect(Date.parse(afterFirst.current_close) - Date.parse(created.current_close)).toBe(180000)
  await expect(page.getByText('Closing time extended', { exact: true })).toHaveCount(1)
  const closeText = await page.evaluate(
    (value) =>
      new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(value)),
    afterFirst.current_close,
  )
  await expect(page.getByTestId('current-close')).toHaveText(closeText)

  await select.selectOption('2')
  await page.getByLabel('Freight charges (INR)', { exact: true }).fill('90.00')
  await page.getByRole('button', { name: 'Submit quote', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Bid #' })).toContainText(
    'accepted at ₹120.00',
  )
  await expect(
    page.getByRole('region', { name: 'Supplier rankings' }).locator('tbody tr').first(),
  ).toContainText('Beacon Freight')
  await expect(page.getByText('Closing time extended', { exact: true })).toHaveCount(2)

  await select.selectOption('1')
  await page.getByLabel('Freight charges (INR)', { exact: true }).fill('100.00')
  await page.getByRole('button', { name: 'Submit quote', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('strictly lower')
  await expect(page.getByLabel('Freight charges (INR)', { exact: true })).toHaveValue('100.00')
  // Another real request wins after frontend validation, before this request reaches PostgreSQL.
  await page.getByLabel('Freight charges (INR)', { exact: true }).fill('95.00')
  await page.route(
    `**/rfqs/${id}/bids`,
    async (route) => {
      const competing = await request.post(`${api}/rfqs/${id}/bids`, {
        data: {
          supplier_id: 1,
          carrier: 'Competing real request',
          freight: '80.00',
          origin: '20.00',
          destination: '10.00',
          transit_hours: 24,
          valid_until: pickup,
        },
      })
      expect(competing.status()).toBe(201)
      await route.continue()
    },
    { times: 1 },
  )
  const rejected = page.waitForResponse(
    (r) => r.url().endsWith(`/rfqs/${id}/bids`) && r.status() === 409,
  )
  await page.getByRole('button', { name: 'Submit quote', exact: true }).click()
  await rejected
  await expect(page.getByRole('alert')).toContainText('strictly lower your previous total')
  await expect(page.getByLabel('Freight charges (INR)', { exact: true })).toHaveValue('95.00')
  await expect(page.getByLabel('Carrier name', { exact: true })).toHaveValue('Browser carrier')
  await page.getByLabel('Freight charges (INR)', { exact: true }).fill('70.00')
  await page.getByRole('button', { name: 'Submit quote', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Bid #' })).toContainText(
    'accepted at ₹100.00',
  )
  await expect(page.getByRole('region', { name: 'Bid history' }).locator('tbody tr')).toHaveCount(4)
  const final = await (await request.get(`${api}/rfqs/${id}`)).json()
  expect(final.ranked_quotes.map((r: { supplier: { id: number } }) => r.supplier.id)).toEqual([
    1, 2,
  ])
  expect(final.bid_history).toHaveLength(4)
  expect(final.activities.filter((a: { kind: string }) => a.kind === 'extended')).toHaveLength(4)
  await expect(
    page.getByRole('region', { name: 'Bid history' }).locator('tbody tr').first(),
  ).toContainText('₹100.00')
  await page.screenshot({ path: testInfo.outputPath('detail-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Submit quote', exact: true })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('detail-mobile.png'), fullPage: true })
  await page.getByRole('link', { name: '← All auctions', exact: true }).click()
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('listing-mobile.png'), fullPage: true })
  await page.locator('#main').focus()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Create RFQ', exact: true }).last()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Create RFQ' })).toBeVisible()
  await page.keyboard.press('Tab')
  // Main receives focus on navigation; keyboard can enter every form control.
  await page.getByLabel('RFQ name', { exact: true }).focus()
  await page.keyboard.type('Keyboard entry retained')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Reference ID', { exact: true })).toBeFocused()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('create-mobile.png'), fullPage: true })
  expect(exceptions).toEqual([])
  // Chromium logs the intentional HTTP 409 as a resource error.
  expect(consoleErrors.filter((message) => !message.includes('409 (Conflict)'))).toEqual([])
  await testInfo.attach('persisted-auction.json', {
    body: JSON.stringify(
      {
        id,
        reference,
        current_close: final.current_close,
        bid_count: final.bid_history.length,
        activity_count: final.activities.length,
        consoleErrors,
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })
})

test('lost response recovery, offline refresh, missing and scheduled auctions', async ({
  page,
  request,
}, testInfo) => {
  const exceptions: string[] = []
  page.on('pageerror', (error) => exceptions.push(error.message))
  const now = Date.parse((await (await request.get(`${api}/health`)).json()).server_now)
  const pickup = new Date(now + 86400000).toISOString().slice(0, 10)
  const input = {
    name: 'Submission recovery verification',
    reference: `RECOVERY-${Date.now()}`,
    british_auction: true,
    bid_start: new Date(now - 60000).toISOString(),
    initial_close: new Date(now + 600000).toISOString(),
    forced_close: new Date(now + 3600000).toISOString(),
    pickup_date: pickup,
    window_minutes: 10,
    extension_minutes: 5,
    trigger: 'any_bid',
  }
  const created = await request.post(`${api}/rfqs`, { data: input })
  expect(created.status()).toBe(201)
  const id = (await created.json()).id
  await page.goto(`/rfqs/${id}`)
  await page.getByLabel('Supplier', { exact: true }).selectOption('1')
  await page.getByLabel('Carrier name', { exact: true }).fill('Preserved carrier')
  await page.getByLabel('Freight charges (INR)', { exact: true }).fill('0.10')
  await page.getByLabel('Origin charges (INR)', { exact: true }).fill('0.20')
  await page.getByLabel('Destination charges (INR)', { exact: true }).fill('0.30')
  await expect(page.getByTestId('quote-total')).toHaveText('₹0.60')
  let writes = 0
  await page.route(
    `**/rfqs/${id}/bids`,
    async (route) => {
      writes += 1
      const saved = await route.fetch()
      expect(saved.status()).toBe(201)
      await route.abort('failed')
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: 'Submit quote', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Acceptance is uncertain')
  await expect(page.getByRole('button', { name: 'Submit quote', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Carrier name', { exact: true })).toHaveValue('Preserved carrier')
  await page.getByRole('button', { name: 'Refresh saved data', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Bid history' }).locator('tbody tr')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Submit quote', exact: true })).toBeEnabled()
  expect(writes).toBe(1)
  expect((await (await request.get(`${api}/rfqs/${id}`)).json()).bid_history).toHaveLength(1)
  await page.context().setOffline(true)
  await page.getByRole('button', { name: 'Refresh auction', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Cannot reach' })).toBeVisible()
  await expect(page.getByLabel('Freight charges (INR)', { exact: true })).toHaveValue('0.10')
  await page.screenshot({ path: testInfo.outputPath('recoverable-offline.png'), fullPage: true })
  await page.context().setOffline(false)
  const scheduled = await request.post(`${api}/rfqs`, {
    data: {
      ...input,
      name: 'Scheduled verification auction',
      reference: `SCHEDULED-${Date.now()}`,
      bid_start: new Date(now + 600000).toISOString(),
      initial_close: new Date(now + 1200000).toISOString(),
    },
  })
  expect(scheduled.status()).toBe(201)
  await page.goto(`/rfqs/${(await scheduled.json()).id}`)
  await expect(page.getByText('Not started', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Carrier name', { exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Submit quote', exact: true })).toBeDisabled()
  await page.goto('/rfqs/999999999')
  await expect(page.getByRole('alert')).toContainText('Auction not found')
  expect(exceptions).toEqual([])
  await testInfo.attach('recovery-evidence.json', {
    body: JSON.stringify({
      rfq_id: id,
      post_requests: writes,
      persisted_bids: 1,
      form_preserved: true,
      offline_refresh_verified: true,
      scheduled_disabled: true,
      missing_rfq_verified: true,
    }),
    contentType: 'application/json',
  })
})
