import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuction, useBoundaryRefresh, useServerNow } from '../api/queries'
import { ErrorNotice, Loading, Status } from '../components/UI'
import { QuoteForm } from '../components/QuoteForm'
import { QuoteTable } from '../components/QuoteTable'
import { money, sortBids } from '../domain/money'
import { countdown, timestamp, timezone } from '../domain/time'
import { triggers } from '../domain/auction'

export function Detail() {
  const { id = '' } = useParams()
  const location = useLocation()
  const query = useAuction(id)
  const auction = query.data?.value
  const now = useServerNow(query.data)
  useBoundaryRefresh(
    query.data,
    auction?.status === 'Active' ? [auction.bid_start, auction.current_close] : [],
    query.refetch,
  )
  if (query.isPending) return <Loading />
  if (!auction)
    return (
      <>
        <Link className="back-link" to="/">
          ← All auctions
        </Link>
        <ErrorNotice
          error={query.error || new Error('Auction could not be loaded.')}
          retry={() => void query.refetch()}
        />
      </>
    )
  const supplierNames = new Map(auction.ranked_quotes.map((r) => [r.supplier.id, r.supplier.name]))
  const bids = new Map(auction.bid_history.map((b) => [b.id, b]))
  const target = auction.not_started ? auction.bid_start : auction.current_close
  return (
    <>
      <Link className="back-link" to="/">
        ← All auctions
      </Link>
      <div className="page-heading detail-heading">
        <div>
          <p className="rfq-reference">
            {auction.reference} <span className="subtle">/ RFQ #{auction.id}</span>
          </p>
          <h1>{auction.name}</h1>
          <Status auction={auction} />
        </div>
        <button
          className="button secondary"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? 'Refreshing…' : 'Refresh auction'}
        </button>
      </div>
      {location.state?.created && auction.bid_history.length === 0 && (
        <div className="notice success" role="status">
          RFQ created.
        </div>
      )}
      {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}
      <div className="summary-grid">
        <section className="summary-card">
          <p className="summary-label">Lowest current quote</p>
          <strong className="hero-price">{money(auction.lowest_bid)}</strong>
          <p>{auction.ranked_quotes[0]?.supplier.name || 'Waiting for the first supplier'}</p>
        </section>
        <section className="summary-card">
          <p className="summary-label">
            {auction.not_started ? 'Starts in' : 'Time to current close'}
          </p>
          <strong className="countdown" data-testid="countdown">
            {auction.status !== 'Active'
              ? 'Bidding closed'
              : now === null
                ? 'Syncing…'
                : countdown(target, now)}
          </strong>
          {auction.status === 'Active' && now !== null && now >= Date.parse(target) && (
            <p>Checking the latest status…</p>
          )}
        </section>
        <section className="summary-card">
          <p className="summary-label">Current close</p>
          <strong className="close-value" data-testid="current-close">
            {timestamp(auction.current_close)}
          </strong>
          <p>
            {auction.current_close !== auction.initial_close
              ? 'Extended from the initial close'
              : 'No extensions yet'}
          </p>
        </section>
      </div>
      <p className="time-note">
        Times in {timezone} · Service and validity are UTC calendar dates.
      </p>
      <div className="detail-layout">
        <div className="detail-content">
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>
                  Supplier rankings <span className="count">{auction.ranked_quotes.length}</span>
                </h2>
                <p>
                  Latest quote per supplier. Lowest total first; earlier accepted quote wins a tie.
                </p>
              </div>
            </div>
            {auction.ranked_quotes.length ? (
              <QuoteTable
                rows={auction.ranked_quotes.map((r) => ({
                  bid: r.quote,
                  supplier: r.supplier.name,
                  rank: r.rank_label,
                }))}
              />
            ) : (
              <div className="empty compact">
                <h3>No bids yet</h3>
                <p>The first accepted quote will appear here as L1.</p>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Auction configuration</h2>
                <p>British Auction enabled</p>
              </div>
            </div>
            <dl className="configuration">
              <div>
                <dt>Bid start</dt>
                <dd>{timestamp(auction.bid_start)}</dd>
              </div>
              <div>
                <dt>Initial close</dt>
                <dd>{timestamp(auction.initial_close)}</dd>
              </div>
              <div>
                <dt>Current close</dt>
                <dd>{timestamp(auction.current_close)}</dd>
              </div>
              <div>
                <dt>Forced close</dt>
                <dd>{timestamp(auction.forced_close)}</dd>
              </div>
              <div>
                <dt>Pickup / service date</dt>
                <dd>
                  {auction.pickup_date} <small>UTC date</small>
                </dd>
              </div>
              <div>
                <dt>Closing window / extension</dt>
                <dd>
                  {auction.window_minutes} min / +{auction.extension_minutes} min
                </dd>
              </div>
              <div className="wide">
                <dt>Extension trigger</dt>
                <dd>
                  {triggers[auction.trigger].label}
                  <small>{triggers[auction.trigger].description}</small>
                </dd>
              </div>
            </dl>
          </section>
          <section className="panel" id="history">
            <div className="section-heading">
              <div>
                <h2>
                  Bid history <span className="count">{auction.bid_history.length}</span>
                </h2>
                <p>Every accepted quote, ordered by total then acceptance sequence.</p>
              </div>
            </div>
            {auction.bid_history.length ? (
              <QuoteTable
                history
                rows={sortBids(auction.bid_history).map((bid) => ({
                  bid,
                  supplier: supplierNames.get(bid.supplier_id) || `Supplier #${bid.supplier_id}`,
                }))}
              />
            ) : (
              <p className="empty compact">No accepted bids to display.</p>
            )}
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>
                  Activity log <span className="count">{auction.activities.length}</span>
                </h2>
                <p>Accepted submissions and actual time extensions, newest first.</p>
              </div>
            </div>
            {auction.activities.length ? (
              <ol className="activity-list">
                {[...auction.activities].reverse().map((event) => {
                  const bid = bids.get(event.bid_id)
                  return (
                    <li
                      key={event.id}
                      className={event.kind === 'extended' ? 'extension-event' : ''}
                    >
                      <span className="activity-mark" aria-hidden="true">
                        {event.kind === 'extended' ? '↗' : '✓'}
                      </span>
                      <div>
                        <strong>
                          {event.kind === 'extended' ? 'Closing time extended' : 'Quote accepted'}
                        </strong>
                        <p>
                          <a href={`#bid-${event.bid_id}`}>Bid #{event.bid_id}</a>
                          {bid && (
                            <>
                              {' '}
                              ·{' '}
                              {supplierNames.get(bid.supplier_id) ||
                                `Supplier #${bid.supplier_id}`}{' '}
                              · {money(bid.total)}
                            </>
                          )}
                        </p>
                        {event.reason && <p>{triggers[event.reason].reason}</p>}
                        {event.old_close && event.new_close && (
                          <p className="extension-times">
                            <span>{timestamp(event.old_close)}</span>
                            <span aria-hidden="true"> → </span>
                            <strong>{timestamp(event.new_close)}</strong>
                          </p>
                        )}
                        <time dateTime={event.occurred_at}>{timestamp(event.occurred_at)}</time>
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <p className="empty compact">
                Activity will appear when the first quote is accepted.
              </p>
            )}
          </section>
        </div>
        <QuoteForm key={auction.id} auction={auction} />
      </div>
    </>
  )
}
