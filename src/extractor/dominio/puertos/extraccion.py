from typing import Protocol

from extractor.dominio.modelo import Linea


class LectorTextoPort(Protocol):
    """Extrae texto nativo (no escaneado) de un PDF, agrupado en líneas."""

    def tiene_texto_nativo(self, ruta_archivo: str) -> bool: ...

    def leer_lineas(self, ruta_archivo: str) -> list[Linea]: ...


class MotorOcrPort(Protocol):
    """OCR sobre una imagen o PDF rasterizado."""

    def reconocer_lineas(self, ruta_archivo: str) -> list[Linea]: ...
