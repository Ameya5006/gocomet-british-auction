from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from threading import Barrier, Event
from time import monotonic

from fastapi.testclient import TestClient
from sqlalchemy import Engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from backend.app.models import RFQ
from backend.app.service import detail, submit_bid
from backend.tests.conftest import BASE_TIME, MutableClock, new_rfq, quote


def test_simultaneous_supplier_requests(
    factory: sessionmaker[Session],
    clock: MutableClock,
    client: TestClient,
) -> None:
    rfq_id = new_rfq(factory, clock)
    clock.set(BASE_TIME + timedelta(minutes=19))
    barrier = Barrier(2)

    def send(supplier: int) -> int:
        barrier.wait(timeout=5)
        response = client.post(
            f'/rfqs/{rfq_id}/bids',
            json=quote(supplier, '100').model_dump(mode='json'),
        )
        return int(response.status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(send, supplier) for supplier in (1, 2)]
        assert [f.result(timeout=10) for f in futures] == [201, 201]
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert view.current_close == BASE_TIME + timedelta(minutes=30)
        assert len(view.bid_history) == 2
        assert [r.quote.id for r in view.ranked_quotes] == [b.id for b in view.bid_history]
        extensions = [a for a in view.activities if a.kind == 'extended']
        assert len(extensions) == 2
        assert extensions[0].new_close == extensions[1].old_close
        assert extensions[1].new_close == view.current_close
        assert [a.bid_id for a in extensions] == [b.id for b in view.bid_history]


def test_same_supplier_competing_requests(
    factory: sessionmaker[Session],
    clock: MutableClock,
    client: TestClient,
) -> None:
    rfq_id = new_rfq(factory, clock)
    submit_bid(factory, rfq_id, quote(total='100'), clock)
    clock.set(BASE_TIME + timedelta(minutes=19))
    barrier = Barrier(2)

    def send(price: str) -> int:
        barrier.wait(timeout=5)
        response = client.post(f'/rfqs/{rfq_id}/bids', json=quote(total=price).model_dump(mode='json'))
        return int(response.status_code)

    with ThreadPoolExecutor(max_workers=2) as pool:
        high = pool.submit(send, '90')
        low = pool.submit(send, '80')
        outcomes = (high.result(timeout=10), low.result(timeout=10))
    assert outcomes in {(201, 201), (409, 201)}
    accepted = outcomes.count(201)
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert str(view.ranked_quotes[0].quote.total) == '80.00'
        assert len(view.ranked_quotes) == 1
        prices = [b.total for b in view.bid_history]
        assert all(a > b for a, b in zip(prices, prices[1:], strict=False))
        assert len(view.bid_history) == 1 + accepted
        assert len(view.activities) == 1 + 2 * accepted
        assert view.current_close == BASE_TIME + timedelta(minutes=20 + 5 * accepted)
        extensions = [a for a in view.activities if a.kind == 'extended']
        assert extensions[-1].new_close == view.current_close
        assert [a.bid_id for a in extensions] == [b.id for b in view.bid_history[1:]]


def wait_for_database_lock(database: Engine, blocker_pid: int) -> None:
    deadline = monotonic() + 5
    with database.connect().execution_options(isolation_level='AUTOCOMMIT') as observer:
        while monotonic() < deadline:
            waiting = observer.scalar(
                text("""
                SELECT count(*) FROM pg_stat_activity
                WHERE datname = current_database()
                  AND :blocker = ANY(pg_blocking_pids(pid))
                  AND wait_event_type = 'Lock'
            """),
                {'blocker': blocker_pid},
            )
            if waiting:
                return
            Event().wait(0.01)
    raise AssertionError('The independent bidder connection never waited on the RFQ row lock')


def test_lock_wait_crosses_close_and_samples_clock_after_lock(
    database: Engine,
    factory: sessionmaker[Session],
    clock: MutableClock,
    client: TestClient,
) -> None:
    rfq_id = new_rfq(factory, clock)
    clock.set(BASE_TIME + timedelta(minutes=20) - timedelta(microseconds=1))
    calls_before = clock.calls
    with ThreadPoolExecutor(max_workers=1) as pool:
        with factory.begin() as blocker:
            blocker.scalar(select(RFQ).where(RFQ.id == rfq_id).with_for_update())
            blocker_pid = blocker.scalar(text('SELECT pg_backend_pid()'))
            assert isinstance(blocker_pid, int)
            future = pool.submit(
                client.post,
                f'/rfqs/{rfq_id}/bids',
                json=quote().model_dump(mode='json'),
            )
            wait_for_database_lock(database, blocker_pid)
            assert clock.calls == calls_before
            assert not future.done()
            clock.set(BASE_TIME + timedelta(minutes=20))
        response = future.result(timeout=10)
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'bidding_unavailable'
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert view.bid_history == []
        assert view.activities == []
        assert view.current_close == view.initial_close


def test_waiting_bid_uses_committed_extension(
    database: Engine,
    factory: sessionmaker[Session],
    clock: MutableClock,
    client: TestClient,
) -> None:
    rfq_id = new_rfq(factory, clock)
    entered_clock = Event()
    release_first = Event()

    def first_clock() -> datetime:
        entered_clock.set()
        assert release_first.wait(timeout=5)
        return BASE_TIME + timedelta(minutes=19)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(submit_bid, factory, rfq_id, quote(), first_clock)
        try:
            assert entered_clock.wait(timeout=5)
            with database.connect() as observer:
                blocker_pid = observer.scalar(
                    text("""
                    SELECT pid FROM pg_stat_activity
                    WHERE datname = current_database() AND state = 'idle in transaction'
                      AND query LIKE '%FOR UPDATE%'
                """)
                )
            assert isinstance(blocker_pid, int)
            second = pool.submit(
                client.post,
                f'/rfqs/{rfq_id}/bids',
                json=quote(2, '90').model_dump(mode='json'),
            )
            wait_for_database_lock(database, blocker_pid)
            # The second bidder waits across the original close. The first bid extends it.
            clock.set(BASE_TIME + timedelta(minutes=20))
        finally:
            release_first.set()
        assert first.result(timeout=10).extended
        response = second.result(timeout=10)
    assert response.status_code == 201
    assert response.json()['server_now'] == '2030-01-01T12:20:00Z'
    with factory() as session:
        view = detail(session, rfq_id, clock())
        assert view.current_close == BASE_TIME + timedelta(minutes=30)
        assert [r.supplier.id for r in view.ranked_quotes] == [2, 1]
        extensions = [a for a in view.activities if a.kind == 'extended']
        assert len(extensions) == 2
        assert extensions[0].new_close == extensions[1].old_close
        assert extensions[-1].new_close == view.current_close
