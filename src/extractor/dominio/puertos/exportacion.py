from typing import Protocol

from extractor.dominio.modelo import ResultadoExtraccion


class ExportadorPort(Protocol):
    def exportar(self, resultado: ResultadoExtraccion, ruta_salida: str) -> str: ...
