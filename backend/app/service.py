from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.domain import (
    AuctionError,
    Clock,
    Standing,
    Trigger,
    auction_status,
    current_standings,
    extended_close,
)
from backend.app.models import RFQ, Activity, Bid, Supplier
from backend.app.schemas import (
    ActivityView,
    BidCreate,
    BidReceipt,
    BidView,
    RankedQuote,
    RFQCreate,
    RFQDetail,
    RFQSummary,
    SupplierView,
)


def standings(bids: list[Bid]) -> list[Standing]:
    return current_standings(Standing(b.id, b.supplier_id, b.total) for b in bids)


def require_rfq(session: Session, rfq_id: int, *, lock: bool = False) -> RFQ:
    statement = select(RFQ).where(RFQ.id == rfq_id)
    if lock:
        statement = statement.with_for_update()
    rfq = session.scalar(statement)
    if rfq is None:
        raise AuctionError('rfq_not_found', 'RFQ does not exist', 404)
    return rfq


def create_rfq(factory: sessionmaker[Session], data: RFQCreate, clock: Clock) -> int:
    with factory.begin() as session:
        now = clock()
        if data.initial_close <= now:
            raise AuctionError('invalid_close', 'Initial close must be in the future', 422)
        rfq = RFQ(**data.model_dump(), current_close=data.initial_close, created_at=now)
        session.add(rfq)
        session.flush()
        return rfq.id


def submit_bid(
    factory: sessionmaker[Session],
    rfq_id: int,
    data: BidCreate,
    clock: Clock,
) -> BidReceipt:
    with factory.begin() as session:
        rfq = require_rfq(session, rfq_id, lock=True)
        now = clock()  # Authoritative acceptance time, sampled only after the row lock.
        if not rfq.bid_start <= now < rfq.current_close or now >= rfq.forced_close:
            raise AuctionError('bidding_unavailable', 'Bidding is outside the active auction period')
        if session.get(Supplier, data.supplier_id) is None:
            raise AuctionError('supplier_not_found', 'Supplier does not exist', 404)
        if data.valid_until < max(rfq.pickup_date, now.date()):
            raise AuctionError('invalid_validity', 'Quote must remain valid through pickup/service date', 422)
        history = list(session.scalars(select(Bid).where(Bid.rfq_id == rfq_id).order_by(Bid.id)))
        old = standings(history)
        previous = next((b for b in old if b.supplier_id == data.supplier_id), None)
        if previous is not None and data.total >= previous.total:
            raise AuctionError('bid_not_lower', 'A subsequent quote must strictly lower your previous total')
        bid = Bid(**data.model_dump(), rfq_id=rfq_id, total=data.total, accepted_at=now)
        session.add(bid)
        session.flush()
        old_close = rfq.current_close
        rfq.current_close = extended_close(
            now=now,
            close=old_close,
            forced=rfq.forced_close,
            x=rfq.window_minutes,
            y=rfq.extension_minutes,
            trigger=Trigger(rfq.trigger),
            old=old,
            new=standings([*history, bid]),
        )
        session.add(
            Activity(
                rfq_id=rfq_id,
                bid_id=bid.id,
                kind='bid_accepted',
                occurred_at=now,
            )
        )
        extended = rfq.current_close > old_close
        if extended:
            session.add(
                Activity(
                    rfq_id=rfq_id,
                    bid_id=bid.id,
                    kind='extended',
                    reason=rfq.trigger,
                    old_close=old_close,
                    new_close=rfq.current_close,
                    occurred_at=now,
                )
            )
        session.flush()
        return BidReceipt(
            bid=BidView.model_validate(bid),
            current_close=rfq.current_close,
            extended=extended,
            extension_reason=Trigger(rfq.trigger) if extended else None,
            server_now=now,
        )


def summary(rfq: RFQ, bids: list[Bid], now: datetime) -> RFQSummary:
    ranked = standings(bids)
    values = {column.key: getattr(rfq, column.key) for column in RFQ.__table__.columns}
    return RFQSummary(
        **values,
        lowest_bid=ranked[0].total if ranked else None,
        status=auction_status(now, rfq.current_close, rfq.forced_close),
        not_started=now < rfq.bid_start,
        server_now=now,
    )


def detail(session: Session, rfq_id: int, now: datetime) -> RFQDetail:
    rfq = require_rfq(session, rfq_id)
    bids = list(session.scalars(select(Bid).where(Bid.rfq_id == rfq_id).order_by(Bid.id)))
    by_id = {b.id: b for b in bids}
    suppliers = {s.id: s for s in session.scalars(select(Supplier))}
    activities = session.scalars(select(Activity).where(Activity.rfq_id == rfq_id).order_by(Activity.id))
    return RFQDetail(
        **summary(rfq, bids, now).model_dump(),
        ranked_quotes=[
            RankedQuote(
                rank=i,
                rank_label=f'L{i}',
                supplier=SupplierView.model_validate(suppliers[b.supplier_id]),
                quote=BidView.model_validate(by_id[b.bid_id]),
            )
            for i, b in enumerate(standings(bids), 1)
        ],
        bid_history=[BidView.model_validate(b) for b in bids],
        activities=[ActivityView.model_validate(a) for a in activities],
    )
