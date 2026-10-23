from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from enum import StrEnum


class Trigger(StrEnum):
    ANY_BID = 'any_bid'
    ANY_RANK_CHANGE = 'any_rank_change'
    L1_CHANGE = 'l1_change'


class AuctionStatus(StrEnum):
    ACTIVE = 'Active'
    CLOSED = 'Closed'
    FORCE_CLOSED = 'Force Closed'


class AuctionError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 409):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


Clock = Callable[[], datetime]


def utc_now() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class Standing:
    bid_id: int
    supplier_id: int
    total: Decimal


def current_standings(history: Iterable[Standing]) -> list[Standing]:
    latest: dict[int, Standing] = {}
    for bid in history:
        if bid.supplier_id not in latest or bid.bid_id > latest[bid.supplier_id].bid_id:
            latest[bid.supplier_id] = bid
    return sorted(latest.values(), key=lambda bid: (bid.total, bid.bid_id))


def qualifies(trigger: Trigger, old: list[Standing], new: list[Standing]) -> bool:
    if trigger == Trigger.ANY_BID:
        return True
    if trigger == Trigger.ANY_RANK_CHANGE:
        return {b.supplier_id: i for i, b in enumerate(old)} != {b.supplier_id: i for i, b in enumerate(new)}
    return (old[0].supplier_id if old else None) != (new[0].supplier_id if new else None)


def extended_close(
    *,
    now: datetime,
    close: datetime,
    forced: datetime,
    x: int,
    y: int,
    trigger: Trigger,
    old: list[Standing],
    new: list[Standing],
) -> datetime:
    if now < close and close - now <= timedelta(minutes=x) and qualifies(trigger, old, new):
        return close + min(timedelta(minutes=y), forced - close)
    return close


def auction_status(now: datetime, close: datetime, forced: datetime) -> AuctionStatus:
    if now < close:
        return AuctionStatus.ACTIVE
    return AuctionStatus.FORCE_CLOSED if close == forced else AuctionStatus.CLOSED
