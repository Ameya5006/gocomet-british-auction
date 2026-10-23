"""Fail-closed local test target selection; call before any test DDL or cleanup."""

from sqlalchemy import Engine, text

from backend.app.config import Settings
from backend.app.db import make_engine

TEST_DATABASE = 'gocomet_rfq_test'
LOOPBACK_HOSTS = {'localhost', '127.0.0.1', '::1'}


def guarded_test_engine(settings: Settings) -> Engine:
    if settings.test_db_name != TEST_DATABASE or settings.db_host not in LOOPBACK_HOSTS:
        raise RuntimeError('Tests require gocomet_rfq_test on an explicit loopback host')
    url = settings.database_url(test=True)
    if url.database != TEST_DATABASE or url.host not in LOOPBACK_HOSTS or url.query:
        raise RuntimeError('Unsafe test database URL')
    engine = make_engine(settings, test=True)
    try:
        with engine.connect() as connection:
            actual = connection.execute(
                text('SELECT current_database(), host(inet_server_addr()), inet_server_port()')
            ).one()
            if (
                actual[0] != TEST_DATABASE
                or actual[1] not in {'127.0.0.1', '::1'}
                or actual[2] != settings.db_port
            ):
                raise RuntimeError('Connected target does not match the dedicated local test database')
    except Exception:
        engine.dispose()
        raise
    return engine
