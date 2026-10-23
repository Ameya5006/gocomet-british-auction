from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.domain import AuctionError, Trigger
from backend.app.models import RFQ, Activity, Bid
from backend.app.service import detail, submit_bid
from backend.tests.conftest import BASE_TIME, MutableClock, new_rfq, quote


@pytest.mark.parametrize('trigger', list(Trigger))
@pytest.mark.parametrize(('minutes', 'extended'), [(0, False), (9, False), (10, True), (19, True)])
def test_first_participant_window(
    factory: sessionmaker[Session],
    clock: MutableClock,
    trigger: Trigger,
    minutes: int,
    extended: bool,
) -> None:
    rfq_id = new_rfq(factory, clock, trigger=trigger)
    clock.set(BASE_TIME + timedelta(minutes=minutes))
    receipt = submit_bid(factory, rfq_id, quote(), clock)
    assert receipt.extended is extended
    assert receipt.extension_reason == (trigger if extended else None)
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert len(view.bid_history) == 1
        assert view.ranked_quotes[0].rank_label == 'L1'
        assert len(view.activities) == (2 if extended else 1)
        assert view.current_close == BASE_TIME + timedelta(minutes=25 if extended else 20)
        assert view.initial_close == BASE_TIME + timedelta(minutes=20)
        assert view.activities[0].bid_id == receipt.bid.id
        if extended:
            extension = view.activities[1]
            assert extension.reason == trigger
            assert extension.old_close == view.initial_close
            assert extension.new_close == view.current_close
            assert extension.occurred_at == clock()


@pytest.mark.parametrize('trigger', list(Trigger))
@pytest.mark.parametrize(
    ('scenario', 'supplier', 'total', 'rank_changed', 'l1_changed'),
    [
        ('unchanged', 2, '180', False, False),
        ('lower_rank_only', 3, '150', True, False),
        ('unchanged_l1', 1, '90', False, False),
        ('new_supplier', 4, '250', True, False),
        ('new_l1', 2, '80', True, True),
    ],
)
def test_trigger_and_nontrigger_rank_changes(
    factory: sessionmaker[Session],
    clock: MutableClock,
    trigger: Trigger,
    scenario: str,
    supplier: int,
    total: str,
    rank_changed: bool,
    l1_changed: bool,
) -> None:
    from backend.app.models import Supplier

    with factory.begin() as session:
        session.add(Supplier(id=4, name='Fourth supplier'))
    rfq_id = new_rfq(factory, clock, trigger=trigger)
    for supplier_id, price in [(1, '100'), (2, '200'), (3, '300')]:
        submit_bid(factory, rfq_id, quote(supplier_id, price), clock)
    clock.set(BASE_TIME + timedelta(minutes=19))
    receipt = submit_bid(factory, rfq_id, quote(supplier, total), clock)
    expected = trigger == Trigger.ANY_BID or (
        rank_changed if trigger == Trigger.ANY_RANK_CHANGE else l1_changed
    )
    assert receipt.extended is expected, scenario
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert len(view.bid_history) == 4
        assert len(view.ranked_quotes) == (4 if supplier == 4 else 3)
        assert sum(a.kind == 'extended' for a in view.activities) == int(expected)


def test_ties_follow_latest_bid_sequence(factory: sessionmaker[Session], clock: MutableClock) -> None:
    rfq_id = new_rfq(factory, clock)
    submit_bid(factory, rfq_id, quote(1, '110'), clock)
    submit_bid(factory, rfq_id, quote(2, '100'), clock)
    submit_bid(factory, rfq_id, quote(1, '100'), clock)
    submit_bid(factory, rfq_id, quote(3, '100'), clock)
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert [r.supplier.id for r in view.ranked_quotes] == [2, 1, 3]
        assert len(view.bid_history) == 4
        assert [r.quote.total for r in view.ranked_quotes] == [Decimal('100.00')] * 3


@pytest.mark.parametrize('price', ['100', '101'])
def test_rebid_must_lower_previous_total(
    factory: sessionmaker[Session],
    clock: MutableClock,
    price: str,
) -> None:
    rfq_id = new_rfq(factory, clock)
    submit_bid(factory, rfq_id, quote(), clock)
    with pytest.raises(AuctionError, match='strictly lower'):
        submit_bid(factory, rfq_id, quote(total=price), clock)
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Bid)) == 1
        assert session.scalar(select(func.count()).select_from(Activity)) == 1


@pytest.mark.parametrize('offset', [-1, 20 * 60, 60 * 60])
def test_start_and_close_rejections(
    factory: sessionmaker[Session],
    clock: MutableClock,
    offset: int,
) -> None:
    rfq_id = new_rfq(factory, clock)
    clock.set(BASE_TIME + timedelta(seconds=offset))
    with pytest.raises(AuctionError, match='outside'):
        submit_bid(factory, rfq_id, quote(), clock)
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Bid)) == 0
        assert session.scalar(select(func.count()).select_from(Activity)) == 0


def test_repeated_updated_windows_cap_and_forced_close(
    factory: sessionmaker[Session],
    clock: MutableClock,
) -> None:
    rfq_id = new_rfq(factory, clock, forced_close=BASE_TIME + timedelta(minutes=32))
    for minute, price, expected_close in [(19, '100', 25), (24, '90', 30), (29, '80', 32)]:
        clock.set(BASE_TIME + timedelta(minutes=minute))
        receipt = submit_bid(factory, rfq_id, quote(total=price), clock)
        assert receipt.extended
        assert receipt.current_close == BASE_TIME + timedelta(minutes=expected_close)
    clock.set(BASE_TIME + timedelta(minutes=31))
    assert not submit_bid(factory, rfq_id, quote(total='70'), clock).extended
    clock.set(BASE_TIME + timedelta(minutes=32))
    with pytest.raises(AuctionError):
        submit_bid(factory, rfq_id, quote(total='60'), clock)
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert view.status == 'Force Closed'
        assert len(view.bid_history) == 4
        assert len(view.activities) == 7
        assert [a.new_close for a in view.activities if a.kind == 'extended'] == [
            BASE_TIME + timedelta(minutes=m) for m in (25, 30, 32)
        ]


def test_recomputed_window_can_exclude_next_bid(factory: sessionmaker[Session], clock: MutableClock) -> None:
    rfq_id = new_rfq(factory, clock, extension_minutes=15)
    clock.set(BASE_TIME + timedelta(minutes=19))
    assert submit_bid(factory, rfq_id, quote(), clock).extended
    # New close is minute 35, so the new window begins at minute 25.
    clock.set(BASE_TIME + timedelta(minutes=24))
    assert not submit_bid(factory, rfq_id, quote(total='90'), clock).extended
    clock.set(BASE_TIME + timedelta(minutes=25))
    assert submit_bid(factory, rfq_id, quote(total='80'), clock).extended


def test_atomic_rollback_after_bid_insert(factory: sessionmaker[Session], clock: MutableClock) -> None:
    rfq_id = new_rfq(factory, clock)
    clock.set(BASE_TIME + timedelta(minutes=19))

    def fail_activity(session: Session, flush_context: object, instances: object) -> None:
        if any(isinstance(obj, Activity) for obj in session.new):
            raise RuntimeError('Injected event persistence failure')

    event.listen(Session, 'before_flush', fail_activity)
    try:
        with pytest.raises(RuntimeError, match='Injected'):
            submit_bid(factory, rfq_id, quote(), clock)
    finally:
        event.remove(Session, 'before_flush', fail_activity)
    with factory() as session:
        assert session.scalar(select(func.count()).select_from(Bid)) == 0
        assert session.scalar(select(func.count()).select_from(Activity)) == 0
        assert session.scalar(select(RFQ.current_close).where(RFQ.id == rfq_id)) == BASE_TIME + timedelta(
            minutes=20
        )


def test_validity_must_cover_pickup_and_missing_supplier(
    factory: sessionmaker[Session],
    clock: MutableClock,
) -> None:
    rfq_id = new_rfq(factory, clock)
    with pytest.raises(AuctionError, match='valid through'):
        submit_bid(factory, rfq_id, quote(valid_until=BASE_TIME.date()), clock)
    with pytest.raises(AuctionError, match='Supplier does not exist'):
        submit_bid(factory, rfq_id, quote(supplier=999), clock)


@pytest.mark.parametrize(
    ('microseconds', 'accepted', 'extends'),
    [
        (-1, False, False),
        (0, True, False),
        (600_000_000 - 1, True, False),
        (600_000_000, True, True),
        (1_200_000_000 - 1, True, True),
        (1_200_000_000, False, False),
    ],
)
def test_microsecond_acceptance_boundaries(
    factory: sessionmaker[Session],
    clock: MutableClock,
    microseconds: int,
    accepted: bool,
    extends: bool,
) -> None:
    rfq_id = new_rfq(factory, clock)
    clock.set(BASE_TIME + timedelta(microseconds=microseconds))
    if accepted:
        assert submit_bid(factory, rfq_id, quote(), clock).extended is extends
    else:
        with pytest.raises(AuctionError):
            submit_bid(factory, rfq_id, quote(), clock)
