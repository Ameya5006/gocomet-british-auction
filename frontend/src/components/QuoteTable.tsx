import type { Bid } from '../api/types'
import { money } from '../domain/money'
import { timestamp } from '../domain/time'

export function QuoteTable({
  rows,
  history = false,
}: {
  rows: { bid: Bid; supplier: string; rank?: string }[]
  history?: boolean
}) {
  return (
    <div
      className="table-scroll"
      tabIndex={0}
      role="region"
      aria-label={history ? 'Bid history' : 'Supplier rankings'}
    >
      <table className="quote-table">
        <thead>
          <tr>
            <th>{history ? 'Bid' : 'Rank'}</th>
            <th>Supplier / carrier</th>
            <th className="money-column">Total (INR)</th>
            <th className="money-column">Freight</th>
            <th className="money-column">Origin</th>
            <th className="money-column">Destination</th>
            <th>Transit</th>
            <th>Valid until</th>
            <th>Accepted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ bid, supplier, rank }) => (
            <tr
              key={bid.id}
              id={history ? `bid-${bid.id}` : undefined}
              className={rank === 'L1' ? 'leading-row' : ''}
              tabIndex={history ? -1 : undefined}
            >
              <td>
                {history ? (
                  <span className="mono">#{bid.id}</span>
                ) : (
                  <span className={`rank ${rank === 'L1' ? 'first' : ''}`}>{rank}</span>
                )}
              </td>
              <td>
                <strong>{supplier}</strong>
                <small>{bid.carrier}</small>
                {!history && (
                  <a className="bid-link" href={`#bid-${bid.id}`}>
                    Bid #{bid.id}
                  </a>
                )}
              </td>
              <td className="price money-column">{money(bid.total)}</td>
              <td className="money-column">{money(bid.freight)}</td>
              <td className="money-column">{money(bid.origin)}</td>
              <td className="money-column">{money(bid.destination)}</td>
              <td>{bid.transit_hours} h</td>
              <td>
                <time dateTime={bid.valid_until}>{bid.valid_until}</time>
                <small>UTC date</small>
              </td>
              <td>
                <time dateTime={bid.accepted_at}>{timestamp(bid.accepted_at)}</time>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
