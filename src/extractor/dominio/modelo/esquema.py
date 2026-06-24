from dataclasses import dataclass, field


@dataclass(frozen=True)
class Validacion:
    regex: str | None = None
    validar_contra: str | None = None  # nombre de un validador externo (puerto)


@dataclass(frozen=True)
class DefinicionCampo:
    nombre: str
    etiquetas: tuple[str, ...]
    tipo: str  # texto | codigo | fecha | moneda | entero
    posicion: str  # abajo | derecha
    obligatorio: bool = False
    region: str | None = None
    formato: str | None = None
    validacion: Validacion | None = None


@dataclass(frozen=True)
class DefinicionRegion:
    desde: str
    hasta: str


@dataclass(frozen=True)
class DefinicionColumna:
    nombre: str
    tipo: str
    validacion: Validacion | None = None


@dataclass(frozen=True)
class DefinicionTabla:
    ancla_inicio: str
    ancla_fin: tuple[str, ...]
    columnas: tuple[DefinicionColumna, ...]


@dataclass(frozen=True)
class ReglaDocumento:
    nombre: str
    descripcion: str
    expresion: str
    severidad: str = "advertencia"


@dataclass(frozen=True)
class EsquemaDocumento:
    tipo: str
    nombre_visible: str
    campos: tuple[DefinicionCampo, ...]
    regiones: dict[str, DefinicionRegion] = field(default_factory=dict)
    detalle: DefinicionTabla | None = None
    reglas_documento: tuple[ReglaDocumento, ...] = ()
    campos_clave_identidad: tuple[str, ...] = ()
    umbral_verde: float = 90.0
    umbral_amarillo: float = 70.0

    def campo(self, nombre: str) -> DefinicionCampo | None:
        return next((c for c in self.campos if c.nombre == nombre), None)
