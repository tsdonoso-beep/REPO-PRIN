from dataclasses import dataclass, field

from .confianza import Confianza
from .token import Fuente


@dataclass
class CampoExtraido:
    nombre: str
    valor: str | None
    confianza: Confianza
    fuente: Fuente | None
    encontrado: bool
    validado: bool = False
    observaciones: list[str] = field(default_factory=list)


@dataclass
class LineaDetalle:
    """Una fila de la tabla de detalle (ej. un ítem de la orden de compra)."""

    columnas: dict[str, str]


@dataclass
class ResultadoExtraccion:
    tipo_documento: str
    archivo_origen: str
    campos: dict[str, CampoExtraido]
    detalle: list[LineaDetalle]
    es_duplicado: bool = False

    @property
    def tiene_excepciones(self) -> bool:
        return any(
            (not c.encontrado) or c.confianza.nivel.value == "rojo"
            for c in self.campos.values()
        )
