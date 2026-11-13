import base64
import hashlib
import hmac
import os
import tempfile
from urllib.parse import parse_qs

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="fridge-test-"))
os.environ["OPENAI_API_KEY"] = ""

import httpx  # noqa: E402
import respx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import courier  # noqa: E402
import main  # noqa: E402

client = TestClient(main.app)


def configure(monkeypatch) -> None:
    for name, value in {
        "TWILIO_SID": "AC123",
        "TWILIO_TOKEN": "twilio-secret",
        "TWILIO_FROM": "+420111222333",
        "COURIER_NUMBER": "+420777888999",
        "PUBLIC_URL": "https://demo.trycloudflare.com/api",
        "OPENAI_API_KEY": "sk-test",
        "TWILIO_API": "https://api.twilio.com/2010-04-01/Accounts/AC123",
    }.items():
        monkeypatch.setattr(courier, name, value)
    courier._call.clear()


def test_call_needs_setup(monkeypatch) -> None:
    for name in ("TWILIO_SID", "TWILIO_TOKEN", "TWILIO_FROM", "COURIER_NUMBER", "PUBLIC_URL"):
        monkeypatch.setattr(courier, name, "")  # the real bridge/.env may have them
    res = client.post("/courier/call")
    assert res.status_code == 503 and "TWILIO_ACCOUNT_SID" in res.json()["detail"]


@respx.mock
def test_call_dials_only_the_courier_and_streams_with_a_key(monkeypatch) -> None:
    configure(monkeypatch)
    route = respx.post("https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json").mock(
        return_value=httpx.Response(201, json={"sid": "CA1"})
    )
    res = client.post("/courier/call")
    assert res.status_code == 200 and res.json()["number"] == "+420 *** *** 999"
    sent = parse_qs(route.calls[0].request.content.decode())
    assert sent["To"] == ["+420777888999"] and sent["From"] == ["+420111222333"]
    assert 'url="wss://demo.trycloudflare.com/api/courier/media"' in sent["Twiml"][0]
    assert courier.STREAM_KEY in sent["Twiml"][0]
    assert sent["StatusCallback"] == ["https://demo.trycloudflare.com/api/courier/status"]
    assert client.post("/courier/call").status_code == 409  # one call at a time


def test_status_needs_twilios_signature(monkeypatch) -> None:
    configure(monkeypatch)
    events = []
    monkeypatch.setattr(courier.hooks, "emit", lambda kind, **data: events.append((kind, data)))
    form = {"CallSid": "CA1", "CallStatus": "in-progress"}
    url = "https://demo.trycloudflare.com/api/courier/status"
    data = url + "".join(k + form[k] for k in sorted(form))
    good = base64.b64encode(hmac.new(b"twilio-secret", data.encode(), hashlib.sha1).digest()).decode()

    assert client.post("/courier/status", data=form, headers={"X-Twilio-Signature": "forged"}).status_code == 403
    assert client.post("/courier/status", data=form, headers={"X-Twilio-Signature": good}).status_code == 204
    assert events == [("call", {"phase": "answered", "number": "+420 *** *** 999", "status": "in-progress"})]


def test_media_stream_without_the_key_is_closed(monkeypatch) -> None:
    configure(monkeypatch)
    with client.websocket_connect("/courier/media") as ws:
        ws.send_json({"event": "connected"})
        ws.send_json({"event": "start", "start": {"streamSid": "MZ1", "customParameters": {"key": "guess"}}})
        try:
            ws.receive_text()
            raise AssertionError("the stream should have been closed")
        except Exception as e:  # starlette raises WebSocketDisconnect with the close code
            assert getattr(e, "code", None) == 1008


def test_call_session_speaks_phone_audio() -> None:
    s = courier.session()
    assert s["audio"]["input"]["format"] == {"type": "audio/pcmu"}
    assert s["audio"]["output"]["format"] == {"type": "audio/pcmu"}
    assert s["tools"][0]["name"] == "end_call"
    assert "Skip the door and come straight onto the stage" in s["instructions"]
