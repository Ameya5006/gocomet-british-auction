from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from backend.app.domain import AuctionStatus, Trigger


def decimal_input(value: object) -> object:
    if isinstance(value, (float, bool)):
        raise ValueError('Send money as a decimal string or integer, never a float')
    return value


def exact_cents(value: Decimal) -> Decimal:
    exponent = value.as_tuple().exponent
    if not isinstance(exponent, int) or exponent < -2:
        raise ValueError('Money allows at most two decimal places')
    return value.quantize(Decimal('0.01'))


Money = Annotated[
    Decimal,
    BeforeValidator(decimal_input, json_schema_input_type=int | str),
    Field(
        ge=0,
        le=Decimal('999999999999.99'),
        allow_inf_nan=False,
        description=(
            'Nonnegative decimal string (at most two decimal places) or integer; maximum 999999999999.99.'
        ),
        examples=['100.50'],
    ),
    AfterValidator(exact_cents),
]
PositiveInt = Annotated[int, Field(strict=True, gt=0, le=2147483647)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
UTCDateTime = Annotated[AwareDatetime, AfterValidator(lambda dt: dt.astimezone(UTC))]


class InputModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RFQCreate(InputModel):
    name: Name
    reference: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    british_auction: Literal[True] = True
    bid_start: UTCDateTime
    initial_close: UTCDateTime
    forced_close: UTCDateTime
    pickup_date: date
    window_minutes: PositiveInt
    extension_minutes: PositiveInt
    trigger: Trigger

    @model_validator(mode='after')
    def valid_dates(self) -> Self:
        if not self.bid_start < self.initial_close < self.forced_close:
            raise ValueError('Require bid_start < initial_close < forced_close')
        if self.pickup_date < self.forced_close.date():
            raise ValueError('Pickup date must be on or after forced close UTC date')
        return self


class BidCreate(InputModel):
    supplier_id: PositiveInt
    carrier: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
    freight: Money
    origin: Money
    destination: Money
    transit_hours: PositiveInt
    valid_until: date

    @property
    def total(self) -> Decimal:
        return self.freight + self.origin + self.destination

    @model_validator(mode='after')
    def positive_total(self) -> Self:
        if self.total <= 0:
            raise ValueError('Total charges must be positive')
        return self


class SupplierView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


class BidView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    rfq_id: int
    supplier_id: int
    carrier: str
    freight: Decimal
    origin: Decimal
    destination: Decimal
    total: Decimal
    transit_hours: int
    valid_until: date
    accepted_at: datetime


class RankedQuote(BaseModel):
    rank: int
    rank_label: str
    supplier: SupplierView
    quote: BidView


class ActivityView(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    rfq_id: int
    bid_id: int
    kind: Literal['bid_accepted', 'extended']
    reason: Trigger | None
    old_close: datetime | None
    new_close: datetime | None
    occurred_at: datetime


class RFQSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    reference: str
    british_auction: bool
    currency: Literal['INR'] = 'INR'
    bid_start: datetime
    initial_close: datetime
    current_close: datetime
    forced_close: datetime
    pickup_date: date
    window_minutes: int
    extension_minutes: int
    trigger: Trigger
    created_at: datetime
    lowest_bid: Decimal | None
    status: AuctionStatus
    not_started: bool
    server_now: datetime


class RFQDetail(RFQSummary):
    ranked_quotes: list[RankedQuote]
    bid_history: list[BidView]
    activities: list[ActivityView]


class RFQList(BaseModel):
    items: list[RFQSummary]
    server_now: datetime


class BidReceipt(BaseModel):
    bid: BidView
    current_close: datetime
    extended: bool
    extension_reason: Trigger | None
    server_now: datetime


class HealthView(BaseModel):
    status: Literal['ok']
    database: Literal['ok']
    server_now: datetime


class ErrorField(BaseModel):
    field: str
    message: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: list[ErrorField] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail
