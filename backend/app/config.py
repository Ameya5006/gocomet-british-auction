from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(ROOT / '.project/local.env', ROOT / '.env'), extra='ignore')
    db_host: str = 'localhost'
    db_port: int = 5432
    db_user: str = 'postgres'
    db_password: SecretStr = SecretStr('')
    db_name: str = 'gocomet_rfq'
    test_db_name: str = 'gocomet_rfq_test'
    cors_origins: list[str] = Field(
        default_factory=lambda: ['http://localhost:5173', 'http://127.0.0.1:5173']
    )

    def database_url(self, *, test: bool = False) -> URL:
        return URL.create(
            'postgresql+psycopg',
            username=self.db_user,
            password=self.db_password.get_secret_value(),
            host=self.db_host,
            port=self.db_port,
            database=self.test_db_name if test else self.db_name,
        )
