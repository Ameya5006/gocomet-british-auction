import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import Engine, select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException

from backend.app.config import Settings
from backend.app.db import make_engine, session_factory
from backend.app.domain import AuctionError, Clock, utc_now
from backend.app.models import RFQ, Bid, Supplier
from backend.app.schemas import (
    BidCreate,
    BidReceipt,
    ErrorResponse,
    HealthView,
    RFQCreate,
    RFQDetail,
    RFQList,
    SupplierView,
)
from backend.app.service import create_rfq, detail, submit_bid, summary

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    *,
    engine: Engine | None = None,
    clock: Clock = utc_now,
) -> FastAPI:
    settings = settings or Settings()
    database = engine if engine is not None else make_engine(settings)
    factory = session_factory(database)
    # A listing/detail uses one stable database snapshot across all its queries.
    readers = session_factory(database.execution_options(isolation_level='REPEATABLE READ'))

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        yield
        if engine is None:
            database.dispose()

    app = FastAPI(
        title='GoComet British Auction API',
        version='0.1.0',
        lifespan=lifespan,
        responses={status: {'model': ErrorResponse} for status in (404, 409, 422, 500, 503)},
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=['GET', 'POST'],
        allow_headers=['Content-Type'],
        allow_credentials=False,
    )

    @app.exception_handler(AuctionError)
    async def auction_error(request: Request, exc: AuctionError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                'error': {'code': exc.code, 'message': exc.message},
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Never echo submitted input or non-serializable validator contexts.
        fields = [{'field': '.'.join(map(str, e['loc'])), 'message': e['msg']} for e in exc.errors()]
        return JSONResponse(
            status_code=422,
            content={
                'error': {'code': 'validation_error', 'message': 'Invalid request', 'fields': fields},
            },
        )

    @app.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        return JSONResponse(
            status_code=409,
            content={
                'error': {
                    'code': 'data_conflict',
                    'message': 'Reference already exists or data violates a constraint',
                },
            },
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        logger.error('Database operation failed (%s)', type(exc).__name__)
        return JSONResponse(
            status_code=503,
            content={
                'error': {'code': 'database_unavailable', 'message': 'Database operation unavailable'},
            },
        )

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            headers=exc.headers,
            content={
                'error': {'code': 'http_error', 'message': str(exc.detail)},
            },
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
        logger.error('Unhandled request failure (%s)', type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={
                'error': {'code': 'internal_error', 'message': 'Request could not be completed'},
            },
        )

    @app.get('/health', response_model=HealthView)
    def health() -> HealthView:
        with factory() as session:
            session.execute(text('SELECT 1'))
        return HealthView(status='ok', database='ok', server_now=clock())

    @app.get('/suppliers', response_model=list[SupplierView])
    def suppliers() -> list[SupplierView]:
        with readers.begin() as session:
            return [
                SupplierView.model_validate(s)
                for s in session.scalars(select(Supplier).order_by(Supplier.id))
            ]

    @app.post('/rfqs', response_model=RFQDetail, status_code=201)
    def add_rfq(data: RFQCreate) -> RFQDetail:
        rfq_id = create_rfq(factory, data, clock)
        with readers.begin() as session:
            return detail(session, rfq_id, clock())

    @app.get('/rfqs', response_model=RFQList)
    def list_rfqs() -> RFQList:
        with readers.begin() as session:
            rfqs = list(session.scalars(select(RFQ).order_by(RFQ.id.desc())))
            now = clock()
            bids = list(session.scalars(select(Bid).order_by(Bid.id)))
            grouped: dict[int, list[Bid]] = {}
            for bid in bids:
                grouped.setdefault(bid.rfq_id, []).append(bid)
            return RFQList(items=[summary(r, grouped.get(r.id, []), now) for r in rfqs], server_now=now)

    @app.get('/rfqs/{rfq_id}', response_model=RFQDetail)
    def get_rfq(rfq_id: int) -> RFQDetail:
        with readers.begin() as session:
            return detail(session, rfq_id, clock())

    @app.post('/rfqs/{rfq_id}/bids', response_model=BidReceipt, status_code=201)
    def add_bid(rfq_id: int, data: BidCreate) -> BidReceipt:
        return submit_bid(factory, rfq_id, data, clock)

    return app


app = create_app()
