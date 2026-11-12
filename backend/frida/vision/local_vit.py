"""Lokální vision transformery (běží doma, bez cloudu).

Tři stupně, všechno jsou modely z rodiny ViT:
1. OWLv2 (open-vocabulary detektor): najde v obrázku věci podle anglických
   dotazů z katalogu ("a carton of milk", "an egg carton"...).
2. SigLIP 2 (zero-shot klasifikace výřezů): každý nalezený výřez znovu porovná
   se všemi popisy z katalogu a vybere nejlepší kanonický klíč.
3. TrOCR (čtení tištěného textu): na výřezech zkusí přečíst datum spotřeby.

Instalace: `uv sync --extra vision-local` (PyTorch + transformers).
Modely se stáhnou při prvním použití do cache Hugging Face.

Tenhle modul se načítá líně, takže Frida běží i bez PyTorch.
"""

from __future__ import annotations

from ..camera.base import Frame
from ..config import Settings
from ..schemas import Detection
from .base import VisionContext, VisionUnavailable


class LocalViTProvider:
    name = "local-vit"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def analyze(self, frame: Frame, context: VisionContext) -> list[Detection]:
        raise VisionUnavailable("Lokální ViT pipeline zatím není nainstalovaná (uv sync --extra vision-local)")
