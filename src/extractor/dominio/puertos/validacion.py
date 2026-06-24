from typing import Protocol


class ValidadorPort(Protocol):
    """Valida un valor extraído contra una fuente de verdad externa
    (ej. maestro SIDIGE, maestro de proveedores, SUNAT)."""

    nombre: str

    def validar(self, valor: str) -> bool: ...
