from dataclasses import dataclass
from enum import Enum


class Fuente(str, Enum):
    TEXTO_NATIVO = "texto_nativo"
    OCR_TESSERACT = "ocr_tesseract"
    LLM_VISION = "llm_vision"


@dataclass(frozen=True)
class Token:
    """Una palabra ubicada en la página, venga de texto nativo u OCR."""

    texto: str
    x0: float
    y0: float
    x1: float
    y1: float
    pagina: int
    fuente: Fuente
    confianza_ocr: float = 100.0  # 100 para texto nativo (no aplica OCR)
