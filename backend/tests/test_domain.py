from datetime import timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from backend.app.domain import (
    AuctionStatus,
    Standing,
    Trigger,
    auction_status,
    current_standings,
    extended_close,
    qualifies,
)
from backend.tests.conftest import BASE_TIME, quote, rfq_input


def standing(bid_id: int, supplier_id: int, total: str) -> Standing:
    return Standing(bid_id, supplier_id, Decimal(total))


def test_latest_quotes_and_earlier_sequence_breaks_ties() -> None:
    history = [standing(1, 1, '100'), standing(2, 2, '90'), standing(3, 1, '90')]
    assert [b.supplier_id for b in current_standings(reversed(history))] == [2, 1]


@pytest.mark.parametrize(
    ('old_ids', 'new_ids', 'expected'),
    [
        ([], [1], (True, True, True)),
        ([1], [1], (True, False, False)),
        ([1], [1, 2], (True, True, False)),
        ([1, 2, 3], [1, 3, 2], (True, True, False)),
        ([1, 2], [2, 1], (True, True, True)),
    ],
)
def test_trigger_mappings(old_ids: list[int], new_ids: list[int], expected: tuple[bool, ...]) -> None:
    old = [standing(i, s, str(i)) for i, s in enumerate(old_ids)]
    new = [standing(i, s, str(i)) for i, s in enumerate(new_ids)]
    assert tuple(qualifies(t, old, new) for t in Trigger) == expected


@pytest.mark.parametrize(('offset', 'extend'), [(-11, False), (-10, True), (-1, True), (0, False)])
def test_exact_window(offset: int, extend: bool) -> None:
    close = BASE_TIME
    result = extended_close(
        now=close + timedelta(minutes=offset),
        close=close,
        forced=close + timedelta(minutes=2),
        x=10,
        y=5,
        trigger=Trigger.ANY_BID,
        old=[],
        new=[standing(1, 1, '1')],
    )
    assert result == close + timedelta(minutes=2 if extend else 0)


def test_at_cap_cannot_extend() -> None:
    assert (
        extended_close(
            now=BASE_TIME - timedelta(seconds=1),
            close=BASE_TIME,
            forced=BASE_TIME,
            x=10,
            y=5,
            trigger=Trigger.ANY_BID,
            old=[],
            new=[],
        )
        == BASE_TIME
    )


@pytest.mark.parametrize(
    ('close_delta', 'forced_delta', 'expected'),
    [
        (1, 10, AuctionStatus.ACTIVE),
        (0, 10, AuctionStatus.CLOSED),
        (-20, -10, AuctionStatus.CLOSED),
        (0, 0, AuctionStatus.FORCE_CLOSED),
    ],
)
def test_status_never_relabels_ordinary_close(
    close_delta: int, forced_delta: int, expected: AuctionStatus
) -> None:
    assert (
        auction_status(
            BASE_TIME,
            BASE_TIME + timedelta(minutes=close_delta),
            BASE_TIME + timedelta(minutes=forced_delta),
        )
        == expected
    )


@pytest.mark.parametrize('invalid', ['0.001', '1.000', '-1', 'NaN', 'Infinity', '1e20', 1.2, True])
def test_money_validation(invalid: object) -> None:
    with pytest.raises(ValidationError):
        quote(freight=invalid)


def test_exact_decimal_total() -> None:
    assert quote(freight='0.10', origin='0.20', destination='0.30').total == Decimal('0.60')


@pytest.mark.parametrize(
    'changes',
    [
        {'freight': '0'},
        {'transit_hours': 0},
        {'transit_hours': 1.5},
        {'supplier_id': True},
        {'carrier': ' '},
        {'valid_until': 'not-a-date'},
        {'accepted_at': BASE_TIME},
    ],
)
def test_invalid_quote(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        quote(**changes)


@pytest.mark.parametrize(
    'changes',
    [
        {'window_minutes': 0},
        {'extension_minutes': -1},
        {'window_minutes': 1.5},
        {'british_auction': False},
        {'name': ' '},
        {'reference': ''},
        {'trigger': 'unknown'},
        {'bid_start': BASE_TIME.replace(tzinfo=None)},
        {'initial_close': BASE_TIME},
        {'forced_close': BASE_TIME + timedelta(minutes=20)},
        {'pickup_date': '2029-12-31'},
        {'current_close': BASE_TIME},
    ],
)
def test_invalid_rfq(changes: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        rfq_input(**changes)
