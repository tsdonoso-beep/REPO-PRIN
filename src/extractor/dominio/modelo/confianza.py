from dataclasses import dataclass
from enum import Enum


class NivelConfianza(str, Enum):
    VERDE = "verde"
    AMARILLO = "amarillo"
    ROJO = "rojo"


@dataclass(frozen=True)
class Confianza:
    puntaje: float  # 0-100
    nivel: NivelConfianza

    @staticmethod
    def calcular(
        puntaje: float, umbral_verde: float, umbral_amarillo: float
    ) -> "Confianza":
        puntaje = max(0.0, min(100.0, puntaje))
        if puntaje >= umbral_verde:
            nivel = NivelConfianza.VERDE
        elif puntaje >= umbral_amarillo:
            nivel = NivelConfianza.AMARILLO
        else:
            nivel = NivelConfianza.ROJO
        return Confianza(puntaje=round(puntaje, 1), nivel=nivel)
