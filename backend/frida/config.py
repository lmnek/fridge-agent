"""Konfigurace Fridy.

Všechno se čte z proměnných prostředí (nebo z `.env`). Každá integrace má svůj
demo režim: když chybí klíč nebo adresa, použije se simulace, takže aplikace
nastartuje i bez jediné proměnné a dá se proklikat.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"),
        env_prefix="FRIDA_",
        extra="ignore",
    )

    # --- obecné -------------------------------------------------------------
    public_base_url: str = Field(
        default="http://localhost:8000",
        description="Veřejná adresa backendu (Twilio na ni volá webhooky). Např. Cloudflare Tunnel.",
    )
    frontend_origin: str = "http://localhost:5173"
    data_dir: Path = DATA_DIR
    database_url: str = ""  # prázdné = sqlite v data_dir
    timezone: str = "Europe/Prague"
    demo_seed: bool = Field(default=True, description="Naplnit prázdnou databázi ukázkovým obsahem lednice.")
    http_user_agent: str = "FridaSmartFridge/0.1 (+https://github.com/frida-smart-fridge)"

    # --- domácnost a poloha -------------------------------------------------
    home_lat: float = 50.0755  # Praha, náměstí Míru (výchozí, prohlížeč ji přepíše)
    home_lon: float = 14.4378
    home_label: str = "Praha 2 – Vinohrady"
    search_radius_m: int = 2500
    favorite_chains: list[str] = ["Albert", "Lidl", "Billa", "Kaufland", "Penny", "Tesco", "Globus"]

    # --- AI (Anthropic) -----------------------------------------------------
    anthropic_api_key: SecretStr | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY")
    agent_model: str = "claude-opus-5-5"
    agent_effort_chat: str = "medium"
    agent_effort_voice: str = "low"
    vision_effort: str = "high"
    agent_fallbacks: bool = True  # server-side fallback při odmítnutí (beta server-side-fallback-2026-07-01)

    # --- kamera (Reolink Home Hub + Argus B310) -----------------------------
    reolink_host: str = ""  # IP adresa Home Hubu v LAN, např. 192.168.1.50
    reolink_username: str = "admin"
    reolink_password: SecretStr | None = None
    reolink_use_https: bool = True
    reolink_channels: list[int] = [0, 1]  # kanál 0 = první kamera na hubu, 1 = druhá
    reolink_camera_names: list[str] = ["Police", "Dveře"]
    reolink_poll_seconds: float = 2.0  # jak často se ptát na PIR/pohyb, když nejsou push události
    reolink_reachable_from_go2rtc: str = ""  # adresa hubu, jak ji vidí go2rtc (výchozí = reolink_host)
    go2rtc_url: str = "http://localhost:1984"  # pro živý náhled (WebRTC/MSE)
    go2rtc_public_url: str = ""  # adresa go2rtc z prohlížeče (výchozí = go2rtc_url)
    live_view_max_seconds: int = 240  # bateriové kamery Reolink drží náhled max. 5 minut
    snapshot_settle_seconds: float = 2.5  # po otevření dveří chvíli počkat, než se rozsvítí a ustálí
    door_open_alert_seconds: int = 120

    # --- vision -------------------------------------------------------------
    vision_provider: str = Field(
        default="auto",
        description=(
            "auto | claude | local | cascade | mock. auto = Claude u skutečných kamer s klíčem, "
            "u demo kamery mock (zná scénu), Claude na demo scéně zapneš hodnotou claude."
        ),
    )
    local_vision_device: str = "auto"  # auto | cpu | mps | cuda
    local_vision_detector: str = "google/owlv2-base-patch16-ensemble"
    local_vision_classifier: str = "google/siglip2-base-patch16-224"
    local_vision_ocr: str = "microsoft/trocr-base-printed"
    local_detection_threshold: float = 0.18
    cascade_escalate_below: float = 0.55  # pod touto jistotou pošle kaskáda snímek i Claudovi

    # --- Rohlík -------------------------------------------------------------
    rohlik_mcp_url: str = ""  # např. https://mcp.rohlik.cz/mcp (doplní se podle docs/integrace/rohlik-mcp.md)
    rohlik_mcp_command: str = ""  # alternativa: lokální stdio server, např. "npx -y @tomaspavlin/rohlik-mcp"
    rohlik_email: SecretStr | None = None
    rohlik_password: SecretStr | None = None
    rohlik_bearer_token: SecretStr | None = None

    # --- akce a obchody -----------------------------------------------------
    deals_sources: list[str] = ["akcniceny"]  # kupi.cz je opt-in, viz docs/integrace/akce-a-obchody.md
    deals_cache_minutes: int = 180
    deals_live: bool = Field(default=False, description="Skutečně scrapovat weby s akcemi (jinak demo data).")
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    geo_live: bool = False
    delivery_live: bool = (
        False  # True = bez demo podniků, jen odkazy do Woltu a foodory (nescrapujeme, viz docs)
    )
    barcode_live: bool = False  # dohledávat EAN v Open Food Facts

    # --- hlas a notifikace (Twilio) -----------------------------------------
    twilio_account_sid: str = ""
    twilio_auth_token: SecretStr | None = None
    twilio_from_number: str = ""  # číslo zakoupené v Twilio (E.164)
    twilio_whatsapp_from: str = ""  # např. whatsapp:+14155238886 (sandbox)
    user_phone: str = ""  # tvoje číslo v E.164, např. +420777123456
    allowed_call_numbers: list[str] = []  # pojistka jako u Volavky: volat jde jen sem
    call_max_seconds: int = 5 * 60
    calls_per_hour: int = 3
    calls_per_day: int = 8
    quiet_hours_start: int = 22  # mezi 22:00 a 7:00 se nevolá, jen tichá notifikace
    quiet_hours_end: int = 7
    call_when_staples_out: int = 2  # od kolika došlých základních potravin Frida zavolá (max 1x denně)
    notify_sms: bool = False
    notify_whatsapp: bool = False
    digest_hour: int = 8  # ranní souhrn
    voice_language: str = "cs-CZ"
    # Výchozí hodnoty Twilia pro cs-CZ (docs/integrace/hlas-twilio.md). Amazon Polly česky neumí.
    voice_tts_provider: str = "ElevenLabs"
    voice_name: str = "uYFJyGaibp4N2VwYQshk"  # alternativa: ttsProvider Google + cs-CZ-Wavenet-B
    voice_transcription_provider: str = "Deepgram"
    voice_speech_model: str = "nova-3-general"
    voice_machine_detection: bool = True
    validate_twilio_signature: bool = True

    # --- odvozené příznaky --------------------------------------------------
    @property
    def has_anthropic(self) -> bool:
        return bool(self.anthropic_api_key and self.anthropic_api_key.get_secret_value())

    @property
    def has_reolink(self) -> bool:
        return bool(self.reolink_host and self.reolink_password)

    @property
    def has_twilio(self) -> bool:
        return bool(self.twilio_account_sid and self.twilio_auth_token and self.twilio_from_number)

    @property
    def has_rohlik(self) -> bool:
        return bool(self.rohlik_mcp_url or self.rohlik_mcp_command)

    @property
    def resolved_vision_provider(self) -> str:
        if self.vision_provider != "auto":
            return self.vision_provider
        return "claude" if self.has_anthropic and self.has_reolink else "mock"

    @property
    def sqlite_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{self.data_dir / 'frida.db'}"

    @property
    def snapshots_dir(self) -> Path:
        path = self.data_dir / "snapshots"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def integration_modes(self) -> dict[str, str]:
        """Co běží naostro a co v simulaci - zobrazuje se v UI v nastavení."""
        return {
            "agent": "live" if self.has_anthropic else "demo",
            "vision": self.resolved_vision_provider,
            "camera": "live" if self.has_reolink else "demo",
            "rohlik": "live" if self.has_rohlik else "demo",
            "voice": "live" if self.has_twilio else "demo",
            "deals": "live" if self.deals_live else "demo",
            "geo": "live" if self.geo_live else "demo",
            "delivery": "live" if self.delivery_live else "demo",
            "barcode": "live" if self.barcode_live else "demo",
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
