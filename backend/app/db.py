from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from backend.app.config import Settings


def make_engine(settings: Settings, *, test: bool = False) -> Engine:
    return create_engine(
        settings.database_url(test=test),
        pool_pre_ping=True,
        hide_parameters=True,
        isolation_level='READ COMMITTED',
        connect_args={'options': '-c timezone=UTC'},
    )


def session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(engine, expire_on_commit=False)
