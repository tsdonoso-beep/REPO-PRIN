from pathlib import Path

import yaml

from extractor.dominio.modelo import (
    DefinicionCampo,
    DefinicionColumna,
    DefinicionRegion,
    DefinicionTabla,
    EsquemaDocumento,
    ReglaDocumento,
    Validacion,
)


def _validacion_de(raw: dict | None) -> Validacion | None:
    if not raw:
        return None
    return Validacion(regex=raw.get("regex"), validar_contra=raw.get("validar_contra"))


class RepositorioEsquemasYaml:
    """Carga EsquemaDocumento desde archivos YAML en una carpeta."""

    def __init__(self, carpeta_esquemas: str):
        self._carpeta = Path(carpeta_esquemas)

    def tipos_disponibles(self) -> list[str]:
        return [p.stem for p in self._carpeta.glob("*.yaml")]

    def cargar(self, tipo_documento: str) -> EsquemaDocumento:
        ruta = self._carpeta / f"{tipo_documento}.yaml"
        if not ruta.exists():
            raise FileNotFoundError(f"No existe esquema para tipo '{tipo_documento}' en {ruta}")

        with ruta.open(encoding="utf-8") as f:
            raw = yaml.safe_load(f)

        campos = tuple(
            DefinicionCampo(
                nombre=nombre,
                etiquetas=tuple(c["etiquetas"]),
                tipo=c.get("tipo", "texto"),
                posicion=c.get("posicion", "abajo"),
                obligatorio=c.get("obligatorio", False),
                region=c.get("region"),
                formato=c.get("formato"),
                validacion=_validacion_de(c.get("validacion")),
            )
            for nombre, c in (raw.get("campos") or {}).items()
        )

        regiones = {
            nombre: DefinicionRegion(desde=r["desde"], hasta=r["hasta"])
            for nombre, r in (raw.get("regiones") or {}).items()
        }

        detalle_raw = raw.get("detalle")
        detalle = None
        if detalle_raw:
            ancla_fin = detalle_raw.get("ancla_fin", [])
            if isinstance(ancla_fin, str):
                ancla_fin = [ancla_fin]
            columnas = tuple(
                DefinicionColumna(
                    nombre=nombre,
                    tipo=c.get("tipo", "texto"),
                    validacion=_validacion_de(c.get("validacion")),
                )
                for nombre, c in (detalle_raw.get("columnas") or {}).items()
            )
            detalle = DefinicionTabla(
                ancla_inicio=detalle_raw["ancla_inicio"],
                ancla_fin=tuple(ancla_fin),
                columnas=columnas,
            )

        reglas = tuple(
            ReglaDocumento(
                nombre=r["nombre"],
                descripcion=r.get("descripcion", ""),
                expresion=r["expresion"],
                severidad=r.get("severidad", "advertencia"),
            )
            for r in (raw.get("reglas_documento") or [])
        )

        identidad = tuple((raw.get("identidad") or {}).get("campos_clave", []))
        confianza_cfg = raw.get("confianza") or {}

        return EsquemaDocumento(
            tipo=raw["tipo"],
            nombre_visible=raw.get("nombre_visible", raw["tipo"]),
            campos=campos,
            regiones=regiones,
            detalle=detalle,
            reglas_documento=reglas,
            campos_clave_identidad=identidad,
            umbral_verde=float(confianza_cfg.get("verde", 90)),
            umbral_amarillo=float(confianza_cfg.get("amarillo", 70)),
        )
