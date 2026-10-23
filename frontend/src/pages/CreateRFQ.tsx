import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { RFQInput, Trigger } from '../api/types'
import { ErrorNotice, Field, FormErrors } from '../components/UI'
import { calendarDate, localInput, localToUtc, timezone } from '../domain/time'
import { positiveInteger, triggers } from '../domain/auction'
import { useServerNow } from '../api/queries'

function defaults() {
  const now = Date.now()
  return {
    name: '',
    reference: '',
    bid_start: localInput(new Date(now + 300000)),
    initial_close: localInput(new Date(now + 3600000)),
    forced_close: localInput(new Date(now + 7200000)),
    pickup_date: new Date(now + 86400000).toISOString().slice(0, 10),
    window_minutes: '10',
    extension_minutes: '5',
    trigger: 'any_bid' as Trigger,
  }
}
export function CreateRFQ() {
  const clock = useQuery({
    queryKey: ['server-clock'],
    queryFn: api.health,
    refetchInterval: 30000,
  })
  const serverNow = useServerNow(clock.data)
  const [form, setForm] = useState(defaults)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [reconciled, setReconciled] = useState(false)
  const [recovery, setRecovery] = useState('')
  const [checking, setChecking] = useState(false)
  const lock = useRef(false)
  const client = useQueryClient()
  const navigate = useNavigate()
  const mutation = useMutation({ mutationFn: api.create, retry: false })
  const update = (key: keyof typeof form, value: string) =>
    setForm((old) => ({ ...old, [key]: value }))
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (
      lock.current ||
      (mutation.error instanceof ApiError && mutation.error.uncertain && !reconciled)
    )
      return
    const next: Record<string, string> = {}
    const converted: Record<string, string> = {}
    for (const key of ['bid_start', 'initial_close', 'forced_close'] as const) {
      try {
        converted[key] = localToUtc(form[key])
      } catch (error) {
        next[key] = (error as Error).message
      }
    }
    for (const key of ['window_minutes', 'extension_minutes'] as const) {
      try {
        positiveInteger(form[key])
      } catch (error) {
        next[key] = (error as Error).message
      }
    }
    if (!form.name.trim()) next.name = 'Enter an RFQ name.'
    if (!form.reference.trim()) next.reference = 'Enter a unique reference.'
    try {
      calendarDate(form.pickup_date)
    } catch (error) {
      next.pickup_date = (error as Error).message
    }
    if (
      converted.bid_start &&
      converted.initial_close &&
      converted.bid_start >= converted.initial_close
    )
      next.initial_close = 'Initial close must be later than bid start.'
    if (
      converted.initial_close &&
      serverNow !== null &&
      Date.parse(converted.initial_close) <= serverNow
    )
      next.initial_close = 'Initial close must still be in the future according to server time.'
    if (
      converted.initial_close &&
      converted.forced_close &&
      converted.initial_close >= converted.forced_close
    )
      next.forced_close = 'Forced close must be later than initial close.'
    if (converted.forced_close && form.pickup_date < converted.forced_close.slice(0, 10))
      next.pickup_date = 'Service date must be on or after the forced-close UTC date.'
    setErrors(next)
    if (Object.keys(next).length) return
    const data: RFQInput = {
      ...form,
      name: form.name.trim(),
      reference: form.reference.trim(),
      british_auction: true,
      bid_start: converted.bid_start,
      initial_close: converted.initial_close,
      forced_close: converted.forced_close,
      window_minutes: positiveInteger(form.window_minutes),
      extension_minutes: positiveInteger(form.extension_minutes),
    }
    lock.current = true
    setReconciled(false)
    setRecovery('')
    try {
      const rfq = await mutation.mutateAsync(data)
      await client.invalidateQueries({ queryKey: ['rfqs'] })
      navigate(`/rfqs/${rfq.id}`, { state: { created: true } })
    } catch (error) {
      if (error instanceof ApiError)
        setErrors({
          ...error.fields,
          ...(error.code === 'data_conflict'
            ? {
                reference:
                  'This reference may already exist. Choose a unique reference or check the listing.',
              }
            : {}),
        })
    } finally {
      lock.current = false
    }
  }
  async function reconcile() {
    setChecking(true)
    try {
      const saved = await api.list()
      client.setQueryData(['rfqs'], saved)
      const match = saved.value.items.find((r) => r.reference === form.reference.trim())
      if (match) {
        navigate(`/rfqs/${match.id}`)
        return
      }
      setReconciled(true)
      setRecovery(
        'Saved auctions refreshed. This reference was not found. Review the form before submitting again.',
      )
    } catch {
      setRecovery('Could not refresh saved auctions. Restore the connection before trying again.')
    } finally {
      setChecking(false)
    }
  }
  return (
    <>
      <Link to="/" className="back-link">
        ← All auctions
      </Link>
      <div className="page-heading">
        <div>
          <h1>Create RFQ</h1>
        </div>
      </div>
      <form className="create-layout" onSubmit={submit} noValidate>
        <div className="form-stack">
          <FormErrors errors={errors} />
          {mutation.error && <ErrorNotice error={mutation.error} />}
          {mutation.error instanceof ApiError && mutation.error.uncertain && (
            <div className="notice">
              <p>Check whether this RFQ was saved before resubmitting.</p>
              <button
                type="button"
                className="button secondary"
                disabled={checking}
                onClick={() => void reconcile()}
              >
                {checking ? 'Checking…' : 'Refresh saved auctions'}
              </button>
              {recovery && <p role="status">{recovery}</p>}
            </div>
          )}
          <fieldset className="panel form-panel" disabled={mutation.isPending}>
            <legend>RFQ details</legend>
            <div className="form-grid">
              <Field
                id="name"
                label="RFQ name"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                maxLength={200}
                required
                error={errors.name}
                placeholder="e.g. Mumbai to Bengaluru freight"
              />
              <Field
                id="reference"
                label="Reference ID"
                value={form.reference}
                onChange={(e) => update('reference', e.target.value)}
                maxLength={80}
                required
                error={errors.reference}
                placeholder="e.g. RFQ-2026-001"
              />
            </div>
            <div className="enabled-option">
              <span aria-hidden="true">✓</span>
              <strong>British Auction enabled</strong>
            </div>
          </fieldset>
          <fieldset className="panel form-panel" disabled={mutation.isPending}>
            <legend>Auction schedule</legend>
            <p className="hint">Enter times in {timezone}.</p>
            <div className="form-grid">
              <Field
                id="bid_start"
                label="Bid start"
                type="datetime-local"
                value={form.bid_start}
                onChange={(e) => update('bid_start', e.target.value)}
                error={errors.bid_start}
                required
              />
              <Field
                id="initial_close"
                label="Initial close"
                type="datetime-local"
                value={form.initial_close}
                onChange={(e) => update('initial_close', e.target.value)}
                error={errors.initial_close}
                hint="Must be after start and still in the future when saved."
                required
              />
              <Field
                id="forced_close"
                label="Forced close"
                type="datetime-local"
                value={form.forced_close}
                onChange={(e) => update('forced_close', e.target.value)}
                error={errors.forced_close}
                hint="Later than initial close. The auction can never extend beyond this."
                required
              />
              <Field
                id="pickup_date"
                label="Pickup / service date"
                type="date"
                value={form.pickup_date}
                onChange={(e) => update('pickup_date', e.target.value)}
                error={errors.pickup_date}
                hint="UTC calendar date, on or after the forced-close UTC date."
                required
              />
            </div>
          </fieldset>
          <fieldset className="panel form-panel" disabled={mutation.isPending}>
            <legend>Extension rules</legend>
            <p className="hint">
              During the last X minutes, a qualifying bid adds Y minutes, up to forced close.
            </p>
            <div className="form-grid">
              <Field
                id="window_minutes"
                label="Closing window · X minutes"
                inputMode="numeric"
                value={form.window_minutes}
                onChange={(e) => update('window_minutes', e.target.value)}
                error={errors.window_minutes}
                required
              />
              <Field
                id="extension_minutes"
                label="Extend by · Y minutes"
                inputMode="numeric"
                value={form.extension_minutes}
                onChange={(e) => update('extension_minutes', e.target.value)}
                error={errors.extension_minutes}
                required
              />
            </div>
            <p className="field-label">What triggers an extension?</p>
            <div className="trigger-options">
              {Object.entries(triggers).map(([value, rule]) => (
                <label
                  className={`trigger-option ${form.trigger === value ? 'selected' : ''}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name="trigger"
                    value={value}
                    checked={form.trigger === value}
                    onChange={() => update('trigger', value)}
                  />
                  <span>
                    <strong>{rule.label}</strong>
                    <small>{rule.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="form-actions">
            <Link to="/" className="button secondary">
              Cancel
            </Link>
            <button
              type="submit"
              className="button primary"
              disabled={
                mutation.isPending ||
                (mutation.error instanceof ApiError && mutation.error.uncertain && !reconciled)
              }
            >
              {mutation.isPending ? 'Creating RFQ…' : 'Create RFQ'}
            </button>
          </div>
        </div>
      </form>
    </>
  )
}
