"""Uživatelské nastavení (poloha, oblíbené řetězce, dieta, notifikace)."""

from __future__ import annotations

from .config import Settings
from .db import DocStore
from .schemas import GeoPoint, UserPreferences, UserPreferencesUpdate
from .voice.policy import mask_phone

PREFS = "prefs"
KEY = "user"


class PrefsService:
    def __init__(self, settings: Settings, store: DocStore) -> None:
        self.settings = settings
        self.store = store

    def _default(self) -> UserPreferences:
        s = self.settings
        return UserPreferences(
            location=GeoPoint(lat=s.home_lat, lon=s.home_lon, label=s.home_label, source="config"),
            favorite_chains=list(s.favorite_chains),
            quiet_hours=(s.quiet_hours_start, s.quiet_hours_end),
        )

    def get(self) -> UserPreferences:
        raw = self.store.get_raw(PREFS, KEY)
        prefs = UserPreferences.model_validate(raw) if raw else self._default()
        prefs.quiet_hours = (self.settings.quiet_hours_start, self.settings.quiet_hours_end)
        prefs.phone_masked = mask_phone(self.settings.user_phone) if self.settings.user_phone else None
        return prefs

    def update(self, patch: UserPreferencesUpdate) -> UserPreferences:
        current = self.get()
        merged = current.model_copy(update=patch.model_dump(exclude_unset=True, exclude_none=True))
        if patch.location is not None:
            merged.location = patch.location
        self.store.put(PREFS, KEY, merged)
        return merged

    def set_location(self, point: GeoPoint) -> UserPreferences:
        return self.update(UserPreferencesUpdate(location=point))

    @property
    def location(self) -> GeoPoint:
        return self.get().location
