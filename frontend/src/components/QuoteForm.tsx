import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { BidInput, RFQDetail } from '../api/types'
import { cents, decimal, MAX_CHARGE, money, totalCharges } from '../domain/money'
import { positiveInteger } from '../domain/auction'
import { calendarDate } from '../domain/time'
import { ErrorNotice, Field, FormErrors, SelectField } from './UI'

export function QuoteForm({ auction }: { auction: RFQDetail }) {
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: api.suppliers, staleTime: 60000 })
  const [form, setForm] = useState({
    supplier_id: '',
    carrier: '',
    freight: '',
    origin: '0.00',
    destination: '0.00',
    transit_hours: '24',
    valid_until: auction.pickup_date,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState('')
  const [reconciled, setReconciled] = useState(false)
  const [recovery, setRecovery] = useState('')
  const [checking, setChecking] = useState(false)
  const lock = useRef(false)
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (data: BidInput) => api.bid(auction.id, data),
    retry: false,
  })
  const previous = auction.ranked_quotes.find((r) => r.supplier.id === Number(form.supplier_id))
    ?.quote.total
  const unavailable = auction.status !== 'Active' || auction.not_started
  const uncertain = mutation.error instanceof ApiError && mutation.error.uncertain && !reconciled
  let total: string | null = null
  try {
    total = totalCharges([form.freight, form.origin, form.destination])
  } catch {
    /* Incomplete input has no total. */
  }
  const update = (key: keyof typeof form, value: string) =>
    setForm((old) => ({ ...old, [key]: value }))
  async function refreshSaved() {
    const data = await client.fetchQuery({
      queryKey: ['rfq', String(auction.id)],
      queryFn: () => api.detail(String(auction.id)),
      staleTime: 0,
    })
    await client.invalidateQueries({ queryKey: ['rfqs'] })
    return data
  }
  async function reconcile() {
    setChecking(true)
    try {
      await refreshSaved()
      setReconciled(true)
      setRecovery(
        'Saved rankings and history refreshed. Check for your bid below before submitting again.',
      )
    } catch {
      setRecovery('Could not refresh saved data. Restore the connection before trying again.')
    } finally {
      setChecking(false)
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (lock.current || uncertain || unavailable) return
    const next: Record<string, string> = {}
    if (!form.supplier_id) next.supplier_id = 'Choose a supplier.'
    if (!form.carrier.trim()) next.carrier = 'Enter a carrier name.'
    for (const key of ['freight', 'origin', 'destination'] as const) {
      try {
        if (cents(form[key]) > MAX_CHARGE) next[key] = 'Maximum charge is 999999999999.99.'
      } catch (error) {
        next[key] = (error as Error).message
      }
    }
    try {
      positiveInteger(form.transit_hours)
    } catch (error) {
      next.transit_hours = (error as Error).message
    }
    try {
      calendarDate(form.valid_until)
    } catch (error) {
      next.valid_until = (error as Error).message
    }
    if (
      form.valid_until < auction.pickup_date ||
      form.valid_until < auction.server_now.slice(0, 10)
    )
      next.valid_until = 'Quote validity must cover the UTC service date and acceptance date.'
    if (total !== null && cents(total) === 0n)
      next.freight = 'Total charges must be greater than zero.'
    if (total !== null && previous && cents(total) >= cents(previous))
      next.freight = `Total must be strictly lower than your previous ${money(previous)}.`
    setErrors(next)
    setSuccess('')
    if (Object.keys(next).length || total === null) return
    lock.current = true
    setReconciled(false)
    setRecovery('')
    try {
      const receipt = await mutation.mutateAsync({
        supplier_id: Number(form.supplier_id),
        carrier: form.carrier.trim(),
        freight: decimal(cents(form.freight)),
        origin: decimal(cents(form.origin)),
        destination: decimal(cents(form.destination)),
        transit_hours: positiveInteger(form.transit_hours),
        valid_until: form.valid_until,
      })
      setSuccess(
        `Bid #${receipt.bid.id} accepted at ${money(receipt.bid.total)}.${receipt.extended ? ' The auction closing time was extended.' : ''}`,
      )
      try {
        await refreshSaved()
      } catch {
        setRecovery(
          'Bid accepted, but the latest view could not be loaded. Refresh saved data to update the workspace.',
        )
      }
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.fields)
      if (!(error instanceof ApiError && error.uncertain)) {
        try {
          await refreshSaved()
        } catch {
          /* Keep the original submission error and form. */
        }
      }
    } finally {
      lock.current = false
    }
  }
  return (
    <section className="panel quote-panel" aria-labelledby="quote-heading">
      <div className="section-heading">
        <div>
          <h2 id="quote-heading">Submit quote</h2>
        </div>
        <span className="badge neutral">INR</span>
      </div>
      {unavailable && (
        <div className="notice">
          {auction.not_started
            ? 'Bidding has not started. The form opens at bid start.'
            : 'This auction is closed. New quotes are no longer accepted.'}
        </div>
      )}
      {suppliers.error && (
        <ErrorNotice error={suppliers.error} retry={() => void suppliers.refetch()} />
      )}
      {success && (
        <div className="notice success" role="status">
          {success}
        </div>
      )}
      {mutation.error && <ErrorNotice error={mutation.error} />}
      {((mutation.error instanceof ApiError && mutation.error.uncertain) || recovery) && (
        <div className="notice">
          <p>
            {recovery || 'Acceptance is uncertain. Review saved bid history before trying again.'}
          </p>
          <button
            className="button secondary"
            type="button"
            onClick={() => void reconcile()}
            disabled={checking}
          >
            {checking ? 'Refreshing…' : 'Refresh saved data'}
          </button>
        </div>
      )}
      <form onSubmit={submit} noValidate>
        <FormErrors errors={errors} />
        <fieldset disabled={mutation.isPending || unavailable} className="quote-fields">
          <legend className="sr-only">Quote details</legend>
          <SelectField
            id="supplier_id"
            label="Supplier"
            value={form.supplier_id}
            onChange={(e) => update('supplier_id', e.target.value)}
            error={errors.supplier_id}
            required
          >
            <option value="">
              {suppliers.isPending ? 'Loading suppliers…' : 'Choose a supplier'}
            </option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          {form.supplier_id && (
            <p className="previous-total">
              {previous ? (
                <>
                  Your previous total: <strong>{money(previous)}</strong>
                  <br />
                  Your next quote must be strictly lower.
                </>
              ) : (
                'This supplier has not submitted a quote yet.'
              )}
            </p>
          )}
          <Field
            id="carrier"
            label="Carrier name"
            value={form.carrier}
            onChange={(e) => update('carrier', e.target.value)}
            maxLength={160}
            error={errors.carrier}
            required
          />
          <div className="charge-fields">
            {(['freight', 'origin', 'destination'] as const).map((key) => (
              <Field
                key={key}
                id={key}
                label={`${key[0].toUpperCase()}${key.slice(1)} charges (INR)`}
                inputMode="decimal"
                value={form[key]}
                onChange={(e) => update(key, e.target.value)}
                error={errors[key]}
                required
                placeholder="0.00"
              />
            ))}
          </div>
          <div className="quote-total">
            <span>Total quote</span>
            <output aria-live="polite" data-testid="quote-total">
              {total === null ? '—' : money(total)}
            </output>
          </div>
          <Field
            id="transit_hours"
            label="Transit time (hours)"
            inputMode="numeric"
            value={form.transit_hours}
            onChange={(e) => update('transit_hours', e.target.value)}
            error={errors.transit_hours}
            required
          />
          <Field
            id="valid_until"
            label="Quote valid until"
            type="date"
            value={form.valid_until}
            onChange={(e) => update('valid_until', e.target.value)}
            error={errors.valid_until}
            hint={`Valid through the service date: ${auction.pickup_date} (UTC).`}
            required
          />
          <button
            className="button primary full-width"
            type="submit"
            disabled={mutation.isPending || uncertain || !suppliers.data?.length}
          >
            {mutation.isPending ? 'Submitting quote…' : 'Submit quote'}
          </button>
        </fieldset>
      </form>
    </section>
  )
}
