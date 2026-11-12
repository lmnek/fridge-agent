"""TwiML pro hovory přes ConversationRelay (bez šablonovacích knihoven, ať je vidět, co jde ven)."""

from __future__ import annotations

from xml.sax.saxutils import escape, quoteattr

from ..config import Settings


def relay_ws_url(settings: Settings) -> str:
    base = settings.public_base_url.rstrip("/")
    if base.startswith("https://"):
        return "wss://" + base.removeprefix("https://") + "/voice/relay"
    if base.startswith("http://"):
        return "ws://" + base.removeprefix("http://") + "/voice/relay"
    return base + "/voice/relay"


def conversation_relay_twiml(settings: Settings, *, greeting: str, session_id: str, reason: str) -> str:
    """`<Connect><ConversationRelay>` s českým rozpoznáváním a hlasem."""
    base = settings.public_base_url.rstrip("/")
    attrs = {
        "url": relay_ws_url(settings),
        "language": settings.voice_language,
        "transcriptionProvider": settings.voice_transcription_provider,
        "speechModel": settings.voice_speech_model,
        "ttsProvider": settings.voice_tts_provider,
        "voice": settings.voice_name,
        "welcomeGreeting": greeting,
        "interruptible": "any",
        "dtmfDetection": "true",
    }
    attr_text = " ".join(f"{k}={quoteattr(v)}" for k, v in attrs.items())
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Connect action={quoteattr(base + '/voice/relay-ended')}>"
        f"<ConversationRelay {attr_text}>"
        f'<Parameter name="frida_session" value={quoteattr(session_id)}/>'
        f'<Parameter name="reason" value={quoteattr(reason[:200])}/>'
        "</ConversationRelay>"
        "</Connect>"
        "</Response>"
    )


def say_twiml(text: str, settings: Settings) -> str:
    """Jednoduchá hláška (např. na záznamník). Používá Google hlas, protože Polly česky neumí."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?><Response>'
        f'<Say language="{settings.voice_language}" voice="Google.cs-CZ-Wavenet-B">{escape(text)}</Say>'
        "<Hangup/></Response>"
    )
