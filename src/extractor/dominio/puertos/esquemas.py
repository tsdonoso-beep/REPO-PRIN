from typing import Protocol

from extractor.dominio.modelo import EsquemaDocumento


class RepositorioEsquemasPort(Protocol):
    def cargar(self, tipo_documento: str) -> EsquemaDocumento: ...

    def tipos_disponibles(self) -> list[str]: ...
