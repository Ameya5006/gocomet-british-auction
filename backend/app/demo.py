import argparse
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import Settings
from backend.app.db import make_engine, session_factory
from backend.app.domain import Trigger, utc_now
from backend.app.models import RFQ, Supplier
from backend.app.schemas import RFQCreate
from backend.app.service import create_rfq

DEMO_SUPPLIERS = [(1, 'Atlas Logistics'), (2, 'Beacon Freight'), (3, 'Cedar Transport')]


def seed_suppliers(factory: sessionmaker[Session]) -> None:
    with factory.begin() as session:
        for supplier_id, name in DEMO_SUPPLIERS:
            session.execute(insert(Supplier).values(id=supplier_id, name=name).on_conflict_do_nothing())


def main() -> None:
    parser = argparse.ArgumentParser(description='Non-destructive, time-relative demonstration setup')
    parser.add_argument(
        '--new-auction', action='store_true', help='Create an additional fresh demo even if one is active'
    )
    args = parser.parse_args()
    engine = make_engine(Settings())
    factory = session_factory(engine)
    try:
        seed_suppliers(factory)
        now = utc_now()
        with factory() as session:
            active = session.scalar(
                select(RFQ.id)
                .where(
                    RFQ.reference.like('DEMO-%'),
                    RFQ.bid_start <= now,
                    RFQ.current_close > now,
                )
                .order_by(RFQ.id.desc())
            )
        if active is not None and not args.new_auction:
            print(f'Suppliers ready; existing active demonstration RFQ {active} retained.')
            return
        close = now + timedelta(minutes=20)
        forced = now + timedelta(hours=1)
        rfq_id = create_rfq(
            factory,
            RFQCreate(
                name='Mumbai to Bengaluru freight',
                reference=f'DEMO-{now:%Y%m%dT%H%M%S%fZ}',
                bid_start=now - timedelta(minutes=1),
                initial_close=close,
                forced_close=forced,
                pickup_date=(forced + timedelta(days=1)).date(),
                window_minutes=10,
                extension_minutes=5,
                trigger=Trigger.ANY_BID,
            ),
            utc_now,
        )
        print(f'Suppliers ready; fresh demonstration RFQ {rfq_id} created.')
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
