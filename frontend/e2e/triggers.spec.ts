import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { BidReceipt, RFQDetail, Trigger } from '../src/api/types'

const api = process.env.E2E_API_BASE_URL || 'http://127.0.0.1:8000'
const cases: {
  trigger: Trigger
  label: string
  unchangedSupplier: string
  unchangedPrice: string
  changedSupplier: string
  changedPrice: string
  ranks: number[]
}[] = [
  {
    trigger: 'any_rank_change',
    label: 'Any supplier rank change',
    unchangedSupplier: '3',
    unchangedPrice: '250.00',
    changedSupplier: '3',
    changedPrice: '150.00',
    ranks: [1, 3, 2],
  },
  {
    trigger: 'l1_change',
    label: 'Lowest bidder changes',
    unchangedSupplier: '1',
    unchangedPrice: '90.00',
    changedSupplier: '2',
    changedPrice: '80.00',
    ranks: [2, 1, 3],
  },
]

async function localInput(page: Page, instant: number) {
  return page.evaluate((time) => {
    const date = new Date(time)
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }, instant)
}

async function assertDisplayedClose(page: Page, close: string) {
  const expected = await page.evaluate(
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
    close,
  )
  await expect(page.getByTestId('current-close')).toHaveText(expected)
}

for (const scenario of cases) {
  test(`${scenario.trigger}: unchanged ranks and qualifying rank change`, async ({
    page,
    request,
  }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    const health = await request.get(`${api}/health`)
    expect(health.ok()).toBeTruthy()
    const now = Date.parse((await health.json()).server_now)
    const reference = `FINAL-${scenario.trigger}-${Date.now()}`
    await page.goto('/rfqs/new')
    await page
      .getByLabel('RFQ name', { exact: true })
      .fill(`Rank trigger verification · ${scenario.label}`)
    await page.getByLabel('Reference ID', { exact: true }).fill(reference)
    for (const [label, offset] of [
      ['Bid start', -60000],
      ['Initial close', 240000],
      ['Forced close', 7200000],
    ] as const) {
      await page.getByLabel(label, { exact: true }).fill(await localInput(page, now + offset))
    }
    await page
      .getByLabel('Pickup / service date', { exact: true })
      .fill(new Date(now + 172800000).toISOString().slice(0, 10))
    await page.getByLabel('Closing window · X minutes', { exact: true }).fill('120')
    await page.getByLabel('Extend by · Y minutes', { exact: true }).fill('3')
    const radio = page.getByRole('radio', { name: new RegExp(`^${scenario.label}`) })
    await radio.check()
    await expect(radio).toBeChecked()
    await page.getByRole('button', { name: 'Create RFQ', exact: true }).click()
    await expect(page).toHaveURL(/\/rfqs\/\d+$/)
    const id = page.url().split('/').pop()!
    const read = async () => {
      const response = await request.get(`${api}/rfqs/${id}`)
      expect(response.status()).toBe(200)
      return (await response.json()) as RFQDetail
    }
    expect((await read()).trigger).toBe(scenario.trigger)
    await expect(page.locator('.configuration')).toContainText(scenario.label)
    await page.getByLabel('Carrier name', { exact: true }).fill('Final trigger carrier')
    const submit = async (supplier: string, price: string) => {
      await page.getByLabel('Supplier', { exact: true }).selectOption(supplier)
      await page.getByLabel('Freight charges (INR)', { exact: true }).fill(price)
      const response = page.waitForResponse(
        (r) => r.url().endsWith(`/rfqs/${id}/bids`) && r.request().method() === 'POST',
      )
      await page.getByRole('button', { name: 'Submit quote', exact: true }).click()
      const accepted = await response
      expect(accepted.status()).toBe(201)
      const receipt = (await accepted.json()) as BidReceipt
      await expect(page.getByRole('status').filter({ hasText: 'Bid #' })).toContainText(
        `Bid #${receipt.bid.id} accepted`,
      )
      return receipt
    }
    await submit('1', '100.00')
    await submit('2', '200.00')
    await submit('3', '300.00')
    const before = await read()
    const countExtensions = (view: RFQDetail) =>
      view.activities.filter((event) => event.kind === 'extended').length
    const unchanged = await submit(scenario.unchangedSupplier, scenario.unchangedPrice)
    const afterUnchanged = await read()
    expect(unchanged.extended).toBe(false)
    expect(afterUnchanged.current_close).toBe(before.current_close)
    expect(countExtensions(afterUnchanged)).toBe(countExtensions(before))
    expect(afterUnchanged.ranked_quotes.map((row) => row.supplier.id)).toEqual([1, 2, 3])
    await assertDisplayedClose(page, before.current_close)
    await expect(page.getByText('Closing time extended', { exact: true })).toHaveCount(
      countExtensions(before),
    )
    const qualifying = await submit(scenario.changedSupplier, scenario.changedPrice)
    const final = await read()
    expect(qualifying.extended).toBe(true)
    expect(qualifying.extension_reason).toBe(scenario.trigger)
    expect(Date.parse(final.current_close) - Date.parse(before.current_close)).toBe(180000)
    expect(final.ranked_quotes.map((row) => row.supplier.id)).toEqual(scenario.ranks)
    const extensions = final.activities.filter((event) => event.kind === 'extended')
    expect(extensions).toHaveLength(countExtensions(before) + 1)
    expect(extensions.at(-1)).toMatchObject({
      reason: scenario.trigger,
      bid_id: qualifying.bid.id,
      old_close: before.current_close,
      new_close: final.current_close,
      occurred_at: qualifying.bid.accepted_at,
    })
    expect(final.bid_history).toHaveLength(5)
    await assertDisplayedClose(page, final.current_close)
    await expect(page.getByText('Closing time extended', { exact: true })).toHaveCount(
      extensions.length,
    )
    const rows = page.getByRole('region', { name: 'Supplier rankings' }).locator('tbody tr')
    for (const [index, supplier] of scenario.ranks.entries()) {
      const name = final.ranked_quotes.find((row) => row.supplier.id === supplier)!.supplier.name
      await expect(rows.nth(index)).toContainText(name)
    }
    expect(errors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath(`${scenario.trigger}.png`), fullPage: true })
    await testInfo.attach('trigger-evidence.json', {
      body: JSON.stringify({ reference, before, afterUnchanged, final }),
      contentType: 'application/json',
    })
  })
}
