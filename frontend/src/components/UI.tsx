import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { ApiError } from '../api/client'
import type { RFQ } from '../api/types'

export function Status({ auction }: { auction: Pick<RFQ, 'status' | 'not_started'> }) {
  return (
    <span className="status-group">
      <span className={`badge ${auction.status === 'Active' ? 'active' : 'closed'}`}>
        <span aria-hidden="true" className="status-dot" />
        {auction.status}
      </span>
      {auction.not_started && <span className="subtle">Not started</span>}
    </span>
  )
}
export function ErrorNotice({ error, retry }: { error: Error; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <strong>
        {error instanceof ApiError && error.status === 404
          ? 'Auction not found'
          : 'Unable to complete the request'}
      </strong>
      <p>{error.message}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          Refresh saved data
        </button>
      )}
    </div>
  )
}
export function Field({
  label,
  hint,
  error,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
  id: string
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        {...props}
        aria-invalid={!!error}
        aria-describedby={hint || error ? `${id}-help` : undefined}
      />
      {(error || hint) && (
        <small id={`${id}-help`} className={error ? 'field-error' : 'hint'}>
          {error || hint}
        </small>
      )}
    </div>
  )
}
export function SelectField({
  label,
  error,
  id,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  error?: string
  id: string
  children: ReactNode
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        {...props}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-help` : undefined}
      >
        {children}
      </select>
      {error && (
        <small className="field-error" id={`${id}-help`}>
          {error}
        </small>
      )}
    </div>
  )
}
export function Loading() {
  return (
    <div className="empty panel" role="status">
      <span className="loading-dot" />
      Loading auction workspace…
    </div>
  )
}
export function FormErrors({ errors }: { errors: Record<string, string> }) {
  if (!Object.keys(errors).length) return null
  return (
    <div className="notice error" role="alert">
      <strong>Check the form before continuing.</strong>
      <ul>
        {Object.entries(errors).map(([key, value]) => (
          <li key={key}>
            <a href={`#${key}`}>{value}</a>
          </li>
        ))}
      </ul>
    </div>
  )
}
