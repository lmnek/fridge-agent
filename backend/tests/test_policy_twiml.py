from datetime import UTC, datetime

from frida.voice.policy import CallPolicy, mask_phone, normalize_phone
from frida.voice.twiml import conversation_relay_twiml, relay_ws_url


def test_normalize_and_mask():
    assert normalize_phone("777 123 456") == "+420777123456"
    assert normalize_phone("00420777123456") == "+420777123456"
    assert mask_phone("+420777123456").endswith("456")
    assert "777" not in mask_phone("+420777123456")[4:]


def test_policy_allowlist_and_quiet_hours(settings):
    s = settings.model_copy(update={"user_phone": "+420777123456", "calls_per_hour": 2, "calls_per_day": 3})
    policy = CallPolicy(s)
    noon = datetime(2026, 11, 13, 11, 0, tzinfo=UTC)  # 12:00 v Praze
    night = datetime(2026, 11, 13, 22, 30, tzinfo=UTC)  # 23:30 v Praze

    assert policy.check("+420777123456", now=noon).allowed
    assert not policy.check("+420600000000", now=noon).allowed  # mimo allowlist
    assert not policy.check("nesmysl", now=noon).allowed
    assert not policy.check("+420777123456", now=night).allowed  # tiché hodiny
    assert policy.check("+420777123456", now=night, urgent=True).allowed

    policy.record_start(noon)
    policy.record_start(noon)
    decision = policy.check("+420777123456", now=noon)
    assert not decision.allowed and "hodinu" in decision.reason


def test_twiml(settings):
    s = settings.model_copy(update={"public_base_url": "https://frida.example.org"})
    assert relay_ws_url(s) == "wss://frida.example.org/voice/relay"
    xml = conversation_relay_twiml(s, greeting="Ahoj & vítej", session_id="call_1", reason="Došlo mléko")
    assert "<ConversationRelay" in xml
    assert 'language="cs-CZ"' in xml
    assert "wss://frida.example.org/voice/relay" in xml
    assert "Ahoj &amp; vítej" in xml
    assert 'value="call_1"' in xml
