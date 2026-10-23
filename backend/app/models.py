from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Supplier(Base):
    __tablename__ = 'suppliers'
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(120), unique=True)


class RFQ(Base):
    __tablename__ = 'rfqs'
    __table_args__ = (
        CheckConstraint('bid_start < initial_close AND initial_close < forced_close', name='rfq_times'),
        CheckConstraint(
            'initial_close <= current_close AND current_close <= forced_close', name='rfq_current_close'
        ),
        CheckConstraint('window_minutes > 0 AND extension_minutes > 0', name='rfq_positive_minutes'),
        CheckConstraint("trigger IN ('any_bid', 'any_rank_change', 'l1_change')", name='rfq_trigger'),
        CheckConstraint('british_auction', name='rfq_enabled'),
        CheckConstraint("pickup_date >= (forced_close AT TIME ZONE 'UTC')::date", name='rfq_pickup'),
        CheckConstraint('length(trim(name)) > 0 AND length(trim(reference)) > 0', name='rfq_names'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    reference: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    british_auction: Mapped[bool] = mapped_column(Boolean, default=True)
    bid_start: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    initial_close: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    current_close: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    forced_close: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    pickup_date: Mapped[date] = mapped_column(Date)
    window_minutes: Mapped[int] = mapped_column(Integer)
    extension_minutes: Mapped[int] = mapped_column(Integer)
    trigger: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Bid(Base):
    __tablename__ = 'bids'
    __table_args__ = (
        CheckConstraint('freight >= 0 AND origin >= 0 AND destination >= 0', name='bid_nonnegative'),
        CheckConstraint('total < 10000000000000000', name='bid_finite'),
        CheckConstraint('total = freight + origin + destination AND total > 0', name='bid_total'),
        CheckConstraint('transit_hours > 0', name='bid_transit'),
        CheckConstraint("valid_until >= (accepted_at AT TIME ZONE 'UTC')::date", name='bid_validity'),
        CheckConstraint('length(trim(carrier)) > 0', name='bid_carrier'),
        UniqueConstraint('rfq_id', 'id', name='bid_rfq_id_unique'),
        Index('ix_bids_rfq_supplier_sequence', 'rfq_id', 'supplier_id', 'id'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rfq_id: Mapped[int] = mapped_column(ForeignKey('rfqs.id'))
    supplier_id: Mapped[int] = mapped_column(ForeignKey('suppliers.id'))
    carrier: Mapped[str] = mapped_column(String(160))
    freight: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    origin: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    destination: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    transit_hours: Mapped[int] = mapped_column(Integer)
    valid_until: Mapped[date] = mapped_column(Date)
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Activity(Base):
    __tablename__ = 'activities'
    __table_args__ = (
        ForeignKeyConstraint(['rfq_id', 'bid_id'], ['bids.rfq_id', 'bids.id'], name='activity_bid_rfq'),
        CheckConstraint("kind IN ('bid_accepted', 'extended')", name='activity_kind'),
        CheckConstraint(
            "(kind = 'bid_accepted' AND reason IS NULL AND old_close IS NULL AND new_close IS NULL) OR "
            "(kind = 'extended' AND reason IS NOT NULL "
            "AND reason IN ('any_bid', 'any_rank_change', 'l1_change') "
            'AND old_close IS NOT NULL AND new_close IS NOT NULL AND new_close > old_close)',
            name='activity_extension',
        ),
        UniqueConstraint('bid_id', 'kind', name='activity_bid_kind_unique'),
        Index('ix_activities_rfq_sequence', 'rfq_id', 'id'),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rfq_id: Mapped[int] = mapped_column(ForeignKey('rfqs.id'))
    bid_id: Mapped[int] = mapped_column(ForeignKey('bids.id'))
    kind: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str | None] = mapped_column(String(24))
    old_close: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    new_close: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
