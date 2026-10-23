from alembic import context

from backend.app.config import Settings
from backend.app.db import make_engine
from backend.app.models import Base

config = context.config
target_metadata = Base.metadata


def run_migrations() -> None:
    connection = config.attributes.get('connection')
    if connection is not None:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = make_engine(Settings())
    try:
        with engine.connect() as connection:
            context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


run_migrations()
