from dataclasses import dataclass

from .token import Token


@dataclass(frozen=True)
class Linea:
    """Tokens agrupados en una línea de lectura, en orden de aparición."""

    tokens: tuple[Token, ...]

    @property
    def texto(self) -> str:
        return " ".join(t.texto for t in self.tokens)

    @property
    def y0(self) -> float:
        return min(t.y0 for t in self.tokens)

    @property
    def y1(self) -> float:
        return max(t.y1 for t in self.tokens)

    @property
    def x0(self) -> float:
        return min(t.x0 for t in self.tokens)
