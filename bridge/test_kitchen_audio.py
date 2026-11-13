import os
import tempfile

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="fridge-test-"))
os.environ["OPENAI_API_KEY"] = ""

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)


def test_kitchen_audio_fans_out_to_every_listener() -> None:
    message = '{"who": "coldex", "audio": "AAAA", "t": 1}'
    with client.websocket_connect("/kitchen/listen") as a, client.websocket_connect("/kitchen/listen") as b:
        with client.websocket_connect("/kitchen/audio") as kitchen:
            kitchen.send_text(message)
            assert a.receive_text() == message
            assert b.receive_text() == message
