from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import ROOT, Settings
from backend.app.db import session_factory
from backend.app.demo import seed_suppliers
from backend.app.domain import Trigger
from backend.app.main import create_app
from backend.app.models import RFQ, Activity, Bid, Supplier
from backend.app.schemas import BidCreate, RFQCreate
from backend.app.service import create_rfq
from backend.tests.database_guard import guarded_test_engine

BASE_TIME = datetime(2030, 1, 1, 12, tzinfo=UTC)


@dataclass
class MutableClock:
    value: datetime = BASE_TIME
    calls: int = 0
    lock: Lock = field(default_factory=Lock)

    def __call__(self) -> datetime:
        with self.lock:
            self.calls += 1
            return self.value

    def set(self, value: datetime) -> None:
        with self.lock:
            self.value = value


def migration_config() -> Config:
    return Config(str(Path(ROOT) / 'alembic.ini'))


@pytest.fixture(scope='session')
def database() -> Iterator[Engine]:
    engine = guarded_test_engine(Settings())
    # The target guard has completed before either migration or test cleanup.
    with engine.begin() as connection:
        config = migration_config()
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')
    yield engine
    engine.dispose()


@pytest.fixture
def factory(database: Engine) -> Iterator[sessionmaker[Session]]:
    factory = session_factory(database)
    with factory.begin() as session:
        for model in (Activity, Bid, RFQ, Supplier):
            session.execute(delete(model))
    seed_suppliers(factory)
    yield factory


@pytest.fixture
def clock() -> MutableClock:
    return MutableClock()


@pytest.fixture
def client(database: Engine, factory: sessionmaker[Session], clock: MutableClock) -> Iterator[TestClient]:
    with TestClient(create_app(engine=database, clock=clock)) as client:
        yield client


def rfq_input(trigger: object = Trigger.ANY_BID, **changes: object) -> RFQCreate:
    values: dict[str, object] = {
        'name': 'Test freight',
        'reference': 'TEST-001',
        'bid_start': BASE_TIME,
        'initial_close': BASE_TIME + timedelta(minutes=20),
        'forced_close': BASE_TIME + timedelta(minutes=60),
        'pickup_date': (BASE_TIME + timedelta(days=1)).date(),
        'window_minutes': 10,
        'extension_minutes': 5,
        'trigger': trigger,
    }
    values.update(changes)
    return RFQCreate.model_validate(values)


def quote(supplier: object = 1, total: object = '100.00', **changes: object) -> BidCreate:
    values: dict[str, object] = {
        'supplier_id': supplier,
        'carrier': 'Test carrier',
        'freight': total,
        'origin': '0.00',
        'destination': '0.00',
        'transit_hours': 24,
        'valid_until': (BASE_TIME + timedelta(days=2)).date(),
    }
    values.update(changes)
    return BidCreate.model_validate(values)


def new_rfq(factory: sessionmaker[Session], clock: MutableClock, **changes: object) -> int:
    return create_rfq(factory, rfq_input(**changes), clock)
