import { Link } from 'react-router-dom'
import { useAuctions, useBoundaryRefresh } from '../api/queries'
import { ErrorNotice, Loading, Status } from '../components/UI'
import { money } from '../domain/money'
import { timestamp, timezone } from '../domain/time'

export function Listing() {
  const query = useAuctions()
  const auctions = query.data?.value.items ?? []
  useBoundaryRefresh(
    query.data,
    auctions.filter((r) => r.status === 'Active').flatMap((r) => [r.bid_start, r.current_close]),
    query.refetch,
  )
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Auctions</h1>
        </div>
        <Link className="button primary" to="/rfqs/new">
          <span aria-hidden="true">＋</span> Create RFQ
        </Link>
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>
              All British Auctions <span className="count">{auctions.length}</span>
            </h2>
            <p>Times in {timezone}.</p>
          </div>
          <button
            className="button secondary small"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {query.error && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}
        {query.isPending ? (
          <Loading />
        ) : !auctions.length && !query.error ? (
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ↗
            </div>
            <h3>No RFQs yet</h3>
            <Link to="/rfqs/new" className="button primary">
              Create RFQ
            </Link>
          </div>
        ) : (
          auctions.length > 0 && (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Auction listing">
              <table className="auction-table">
                <thead>
                  <tr>
                    <th>Auction / reference</th>
                    <th className="money-column">Lowest quote</th>
                    <th>Current close</th>
                    <th>Forced close</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {auctions.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link className="row-link" to={`/rfqs/${r.id}`}>
                          {r.name}
                          <span aria-hidden="true"> ↗</span>
                        </Link>
                        <small>
                          {r.reference} · RFQ #{r.id}
                        </small>
                      </td>
                      <td className="price money-column">{money(r.lowest_bid)}</td>
                      <td>
                        <time dateTime={r.current_close}>{timestamp(r.current_close)}</time>
                      </td>
                      <td>
                        <time dateTime={r.forced_close}>{timestamp(r.forced_close)}</time>
                      </td>
                      <td>
                        <Status auction={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>
    </>
  )
}
