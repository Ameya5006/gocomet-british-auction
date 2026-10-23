from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine
from sqlalchemy.exc import OperationalError

from backend.app.main import create_app
from backend.tests.conftest import BASE_TIME, MutableClock, quote, rfq_input


def test_full_api_persistence(client: TestClient, clock: MutableClock) -> None:
    assert client.get('/health').json()['database'] == 'ok'
    assert [s['id'] for s in client.get('/suppliers').json()] == [1, 2, 3]
    clock.set(BASE_TIME - timedelta(minutes=1))
    created = client.post('/rfqs', json=rfq_input().model_dump(mode='json'))
    assert created.status_code == 201, created.text
    body = created.json()
    rfq_id = body['id']
    assert body['not_started'] is True
    assert body['status'] == 'Active'
    assert body['currency'] == 'INR'
    assert body['lowest_bid'] is None
    assert body['ranked_quotes'] == body['bid_history'] == body['activities'] == []
    assert client.post(f'/rfqs/{rfq_id}/bids', json=quote().model_dump(mode='json')).status_code == 409
    clock.set(BASE_TIME)
    accepted = client.post(f'/rfqs/{rfq_id}/bids', json=quote().model_dump(mode='json'))
    assert accepted.status_code == 201, accepted.text
    assert accepted.json()['server_now'] == '2030-01-01T12:00:00Z'
    clock.set(BASE_TIME + timedelta(minutes=19))
    second = client.post(f'/rfqs/{rfq_id}/bids', json=quote(2, '90').model_dump(mode='json'))
    assert second.status_code == 201
    assert second.json()['extension_reason'] == 'any_bid'
    view = client.get(f'/rfqs/{rfq_id}').json()
    assert view['not_started'] is False
    assert view['lowest_bid'] == '90.00'
    assert [r['supplier']['id'] for r in view['ranked_quotes']] == [2, 1]
    assert [r['rank_label'] for r in view['ranked_quotes']] == ['L1', 'L2']
    assert view['ranked_quotes'][0]['quote']['transit_hours'] == 24
    assert view['ranked_quotes'][0]['quote']['valid_until'] == '2030-01-03'
    assert len(view['bid_history']) == 2
    assert len(view['activities']) == 3
    for field in ('bid_start', 'initial_close', 'current_close', 'forced_close', 'created_at', 'server_now'):
        assert view[field].endswith('Z')
    assert all(b['accepted_at'].endswith('Z') for b in view['bid_history'])
    assert all(a['occurred_at'].endswith('Z') for a in view['activities'])
    assert view['activities'][-1]['bid_id'] == second.json()['bid']['id']
    listing = client.get('/rfqs').json()
    assert listing['items'][0]['current_close'] == view['current_close']
    assert listing['items'][0]['lowest_bid'] == view['lowest_bid']
    assert listing['server_now'] == view['server_now']
    clock.set(BASE_TIME + timedelta(minutes=25))
    assert client.get(f'/rfqs/{rfq_id}').json()['status'] == 'Closed'
    clock.set(BASE_TIME + timedelta(hours=2))
    assert client.get(f'/rfqs/{rfq_id}').json()['status'] == 'Closed'


def test_reference_unique_config_immutable(client: TestClient) -> None:
    payload = rfq_input().model_dump(mode='json')
    response = client.post('/rfqs', json=payload)
    assert response.status_code == 201
    assert client.post('/rfqs', json=payload).status_code == 409
    rfq_id = response.json()['id']
    assert client.patch(f'/rfqs/{rfq_id}', json={'window_minutes': 1}).status_code == 405
    assert client.get(f'/rfqs/{rfq_id}').json()['window_minutes'] == 10


@pytest.mark.parametrize(
    'changes',
    [
        {'freight': '1.001'},
        {'origin': '-1'},
        {'freight': 1.2},
        {'transit_hours': 0},
        {'accepted_at': '2030-01-01T12:00:00Z'},
        {'supplier_id': None},
    ],
)
def test_api_invalid_bid(client: TestClient, changes: dict[str, object]) -> None:
    created = client.post('/rfqs', json=rfq_input().model_dump(mode='json')).json()
    payload = quote().model_dump(mode='json')
    payload.update(changes)
    response = client.post(f'/rfqs/{created["id"]}/bids', json=payload)
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'validation_error'
    assert all('input' not in field for field in response.json()['error']['fields'])
    view = client.get(f'/rfqs/{created["id"]}').json()
    assert view['bid_history'] == view['activities'] == []


def test_missing_resources_and_invalid_create(client: TestClient, clock: MutableClock) -> None:
    assert client.get('/rfqs/999999').json()['error']['code'] == 'rfq_not_found'
    assert client.post('/rfqs/999999/bids', json=quote().model_dump(mode='json')).status_code == 404
    data = rfq_input().model_dump(mode='json')
    data['bid_start'] = '2030-01-01T12:00:00'
    assert client.post('/rfqs', json=data).status_code == 422
    clock.set(BASE_TIME + timedelta(hours=1))
    assert client.post('/rfqs', json=rfq_input().model_dump(mode='json')).status_code == 422


def test_localhost_cors_and_openapi(client: TestClient) -> None:
    allowed = client.options(
        '/rfqs',
        headers={
            'Origin': 'http://localhost:5173',
            'Access-Control-Request-Method': 'POST',
        },
    )
    assert allowed.headers['access-control-allow-origin'] == 'http://localhost:5173'
    assert (
        'access-control-allow-origin'
        not in client.get(
            '/rfqs',
            headers={
                'Origin': 'https://unrelated.example',
            },
        ).headers
    )
    schema = client.get('/openapi.json').json()
    assert schema['paths']['/rfqs/{rfq_id}/bids']['post']['responses']['201']
    assert schema['components']['schemas']['RFQCreate']['additionalProperties'] is False


def test_money_openapi_matches_accepted_json_inputs(client: TestClient) -> None:
    schema = client.get('/openapi.json').json()
    money_fields = schema['components']['schemas']['BidCreate']['properties']
    for name in ('freight', 'origin', 'destination'):
        assert {option['type'] for option in money_fields[name]['anyOf']} == {'integer', 'string'}
        assert money_fields[name]['examples'] == ['100.50']

    rfq_id = client.post('/rfqs', json=rfq_input().model_dump(mode='json')).json()['id']
    payload = quote().model_dump(mode='json')
    for value, status in [('100.50', 201), (100, 201), (100.5, 422), (True, 422)]:
        payload['freight'] = value
        response = client.post(f'/rfqs/{rfq_id}/bids', json=payload)
        assert response.status_code == status, response.text
        if status == 201:
            assert response.json()['bid']['freight'] == ('100.50' if isinstance(value, str) else '100.00')


def test_database_and_unexpected_errors_are_safe(
    database: Engine,
    client: TestClient,
    clock: MutableClock,
) -> None:
    rfq_id = client.post('/rfqs', json=rfq_input().model_dump(mode='json')).json()['id']
    errors = [
        (OperationalError('private SQL diagnostic', {}, Exception('private driver diagnostic')), 503),
        (RuntimeError('private unexpected diagnostic'), 500),
    ]
    with TestClient(create_app(engine=database, clock=clock), raise_server_exceptions=False) as safe_client:
        for error, expected_status in errors:
            with patch('backend.app.main.submit_bid', side_effect=error):
                response = safe_client.post(f'/rfqs/{rfq_id}/bids', json=quote().model_dump(mode='json'))
            assert response.status_code == expected_status
            assert 'private' not in response.text
            assert set(response.json()) == {'error'}
        assert safe_client.get('/unknown').json()['error']['code'] == 'http_error'
