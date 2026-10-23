from datetime import timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import Settings
from backend.app.models import RFQ, Activity, Base, Bid
from backend.app.service import submit_bid
from backend.tests.conftest import BASE_TIME, MutableClock, migration_config, new_rfq, quote, rfq_input
from backend.tests.database_guard import guarded_test_engine


def test_database_session_uses_utc(factory: sessionmaker[Session]) -> None:
    with factory() as session:
        assert session.scalar(text('SHOW TimeZone')) == 'UTC'


@pytest.mark.parametrize(
    ('name', 'host'),
    [
        ('gocomet_rfq', 'localhost'),
        ('other', 'localhost'),
        ('gocomet_rfq_test', 'remote.example'),
        ('gocomet_rfq_test', '127.0.0.2'),
    ],
)
def test_guard_rejects_unsafe_configuration_before_connect(name: str, host: str) -> None:
    with patch('backend.tests.database_guard.make_engine') as make:
        with pytest.raises(RuntimeError, match='Tests require'):
            guarded_test_engine(Settings(test_db_name=name, db_host=host))
        make.assert_not_called()


@pytest.mark.parametrize(
    'actual',
    [
        ('gocomet_rfq', '127.0.0.1', 5432),
        ('gocomet_rfq_test', '192.0.2.1', 5432),
        ('gocomet_rfq_test', '127.0.0.1', 9999),
    ],
)
def test_guard_rejects_mismatched_connection(actual: tuple[str, str, int]) -> None:
    engine = MagicMock()
    engine.connect.return_value.__enter__.return_value.execute.return_value.one.return_value = actual
    with patch('backend.tests.database_guard.make_engine', return_value=engine):
        with pytest.raises(RuntimeError, match='Connected target'):
            guarded_test_engine(Settings(db_host='localhost', db_port=5432))
    engine.dispose.assert_called_once()


@pytest.mark.parametrize(
    'changes',
    [
        {'window_minutes': 0},
        {'extension_minutes': -1},
        {'british_auction': False},
        {'trigger': 'invalid'},
        {'bid_start': BASE_TIME + timedelta(hours=1)},
        {'forced_close': BASE_TIME},
        {'pickup_date': BASE_TIME.date() - timedelta(days=1)},
        {'current_close': BASE_TIME + timedelta(minutes=25)},
        {'name': ''},
    ],
)
def test_database_rfq_constraints(factory: sessionmaker[Session], changes: dict[str, object]) -> None:
    values = rfq_input().model_dump()
    values.update(current_close=values['initial_close'], created_at=BASE_TIME)
    values.update(changes)
    with pytest.raises(IntegrityError), factory.begin() as session:
        session.add(RFQ(**values))
        session.flush()


@pytest.mark.parametrize(
    'changes',
    [
        {'window_minutes': 1},
        {'name': 'Renamed'},
        {'reference': 'REPLACED'},
        {'initial_close': BASE_TIME + timedelta(minutes=21)},
        {'forced_close': BASE_TIME + timedelta(hours=2)},
        {'trigger': 'l1_change'},
        {'pickup_date': (BASE_TIME + timedelta(days=3)).date()},
    ],
)
def test_configuration_immutable_in_database(
    factory: sessionmaker[Session],
    clock: MutableClock,
    changes: dict[str, object],
) -> None:
    rfq_id = new_rfq(factory, clock)
    with pytest.raises(IntegrityError), factory.begin() as session:
        session.execute(update(RFQ).where(RFQ.id == rfq_id).values(**changes))


def test_current_close_cannot_decrease(factory: sessionmaker[Session], clock: MutableClock) -> None:
    rfq_id = new_rfq(factory, clock)
    clock.set(BASE_TIME + timedelta(minutes=19))
    submit_bid(factory, rfq_id, quote(), clock)
    with pytest.raises(IntegrityError), factory.begin() as session:
        session.execute(
            update(RFQ)
            .where(RFQ.id == rfq_id)
            .values(
                current_close=BASE_TIME + timedelta(minutes=20),
            )
        )


@pytest.mark.parametrize(
    'changes',
    [
        {'freight': Decimal('-1'), 'total': Decimal('-1')},
        {'total': Decimal('99')},
        {'freight': Decimal('0'), 'total': Decimal('0')},
        {'supplier_id': 999999},
        {'rfq_id': 999999},
        {'transit_hours': 0},
        {'valid_until': BASE_TIME.date() - timedelta(days=1)},
        {'freight': Decimal('NaN'), 'total': Decimal('NaN')},
    ],
)
def test_database_bid_constraints(
    factory: sessionmaker[Session],
    clock: MutableClock,
    changes: dict[str, object],
) -> None:
    rfq_id = new_rfq(factory, clock)
    data = quote()
    values = data.model_dump()
    values.update(total=data.total, rfq_id=rfq_id, accepted_at=BASE_TIME)
    values.update(changes)
    with pytest.raises(IntegrityError), factory.begin() as session:
        session.add(Bid(**values))
        session.flush()


def test_activity_references_matching_bid_rfq(factory: sessionmaker[Session], clock: MutableClock) -> None:
    first = new_rfq(factory, clock)
    second = new_rfq(factory, clock, reference='TEST-002')
    receipt = submit_bid(factory, first, quote(), clock)
    with pytest.raises(IntegrityError), factory.begin() as session:
        session.add(
            Activity(rfq_id=second, bid_id=receipt.bid.id, kind='bid_accepted', occurred_at=BASE_TIME)
        )
        session.flush()


def test_migration_roundtrip_and_metadata(
    database: Engine,
    factory: sessionmaker[Session],
) -> None:
    # Only the already guarded dedicated test database is ever downgraded.
    config = migration_config()
    with database.begin() as connection:
        assert connection.scalar(text('SELECT current_database()')) == 'gocomet_rfq_test'
        config.attributes['connection'] = connection
        command.downgrade(config, 'base')
        command.upgrade(config, 'head')
        context = MigrationContext.configure(connection, opts={'compare_type': True})
        assert compare_metadata(context, Base.metadata) == []
        assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '52b4f1033008'
        assert connection.scalar(select(func.count()).select_from(RFQ)) == 0
