from datetime import timedelta
from unittest.mock import patch

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, sessionmaker

from backend.app.demo import main
from backend.app.models import RFQ, Bid, Supplier
from backend.app.service import submit_bid
from backend.tests.conftest import BASE_TIME, MutableClock, quote


def test_demo_is_repeatable_preserves_data_and_refreshes_expired_auctions(
    database: Engine,
    factory: sessionmaker[Session],
    clock: MutableClock,
) -> None:
    with (
        patch('backend.app.demo.make_engine', return_value=database),
        patch('backend.app.demo.utc_now', side_effect=clock),
        patch('sys.argv', ['demo']),
    ):
        main()
        with factory() as session:
            rfq_id = session.scalar(select(RFQ.id))
            assert isinstance(rfq_id, int)
        submit_bid(factory, rfq_id, quote(), clock)
        main()
        with factory() as session:
            assert session.scalar(select(func.count()).select_from(RFQ)) == 1
            assert session.scalar(select(func.count()).select_from(Supplier)) == 3
            assert session.scalar(select(func.count()).select_from(Bid)) == 1
        clock.set(BASE_TIME + timedelta(days=1))
        main()
        with factory() as session:
            auctions = list(session.scalars(select(RFQ).order_by(RFQ.id)))
            assert len(auctions) == 2
            assert auctions[1].bid_start <= clock() < auctions[1].current_close
            assert auctions[0].current_close < clock()
            assert session.scalar(select(func.count()).select_from(Bid)) == 1
