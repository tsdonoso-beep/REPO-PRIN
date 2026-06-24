import re

from rapidfuzz import fuzz

from extractor.dominio.modelo import (
    CampoExtraido,
    Confianza,
    DefinicionCampo,
    EsquemaDocumento,
    Linea,
    LineaDetalle,
)

UMBRAL_MATCH_ANCLA = 80.0  # score mínimo (0-100) para aceptar que una línea es la etiqueta buscada


def _mejor_match(texto_linea: str, etiquetas: tuple[str, ...]) -> float:
    return max(fuzz.partial_ratio(texto_linea.lower(), e.lower()) for e in etiquetas)


def _buscar_ancla(lineas: list[Linea], etiquetas: tuple[str, ...], desde: int, hasta: int) -> int | None:
    mejor_idx, mejor_score = None, 0.0
    for i in range(desde, hasta):
        score = _mejor_match(lineas[i].texto, etiquetas)
        if score > mejor_score:
            mejor_idx, mejor_score = i, score
    if mejor_score >= UMBRAL_MATCH_ANCLA:
        return mejor_idx
    return None


def _delimitar_region(lineas: list[Linea], desde_txt: str, hasta_txt: str) -> tuple[int, int]:
    inicio = _buscar_ancla(lineas, (desde_txt,), 0, len(lineas))
    inicio = (inicio + 1) if inicio is not None else 0
    fin = _buscar_ancla(lineas, (hasta_txt,), inicio, len(lineas))
    fin = fin if fin is not None else len(lineas)
    return inicio, fin


class MotorExtraccion:
    """Extrae campos de cabecera y filas de detalle de un documento, según su
    EsquemaDocumento, a partir de las líneas ya leídas (texto nativo u OCR)."""

    def extraer_campos(
        self, lineas: list[Linea], esquema: EsquemaDocumento
    ) -> dict[str, CampoExtraido]:
        regiones_resueltas = {
            nombre: _delimitar_region(lineas, r.desde, r.hasta)
            for nombre, r in esquema.regiones.items()
        }

        resultado: dict[str, CampoExtraido] = {}
        for campo in esquema.campos:
            desde, hasta = (0, len(lineas))
            if campo.region and campo.region in regiones_resueltas:
                desde, hasta = regiones_resueltas[campo.region]
            resultado[campo.nombre] = self._extraer_campo(lineas, campo, desde, hasta, esquema)
        return resultado

    def _extraer_campo(
        self,
        lineas: list[Linea],
        campo: DefinicionCampo,
        desde: int,
        hasta: int,
        esquema: EsquemaDocumento,
    ) -> CampoExtraido:
        idx = _buscar_ancla(lineas, campo.etiquetas, desde, hasta)
        if idx is None:
            return CampoExtraido(
                nombre=campo.nombre,
                valor=None,
                confianza=Confianza.calcular(0, esquema.umbral_verde, esquema.umbral_amarillo),
                fuente=None,
                encontrado=False,
                observaciones=["Etiqueta no encontrada en el documento."],
            )

        linea_ancla = lineas[idx]
        if campo.posicion == "derecha":
            etiqueta_match = max(campo.etiquetas, key=lambda e: fuzz.partial_ratio(linea_ancla.texto.lower(), e.lower()))
            valor = self._texto_a_la_derecha(linea_ancla.texto, etiqueta_match)
            tokens_valor = linea_ancla.tokens
        else:  # "abajo"
            if idx + 1 >= hasta:
                valor, tokens_valor = None, ()
            else:
                valor = lineas[idx + 1].texto
                tokens_valor = lineas[idx + 1].tokens

        if not valor:
            return CampoExtraido(
                nombre=campo.nombre,
                valor=None,
                confianza=Confianza.calcular(0, esquema.umbral_verde, esquema.umbral_amarillo),
                fuente=tokens_valor[0].fuente if tokens_valor else None,
                encontrado=False,
                observaciones=["Ancla encontrada pero sin valor adyacente."],
            )

        confianza_ocr_prom = (
            sum(t.confianza_ocr for t in tokens_valor) / len(tokens_valor) if tokens_valor else 0
        )
        observaciones: list[str] = []
        valido = True
        if campo.validacion and campo.validacion.regex:
            valido = re.fullmatch(campo.validacion.regex, valor.strip()) is not None
            if not valido:
                observaciones.append(f"No cumple el formato esperado ({campo.validacion.regex}).")

        puntaje = confianza_ocr_prom if valido else confianza_ocr_prom * 0.4
        return CampoExtraido(
            nombre=campo.nombre,
            valor=valor.strip(),
            confianza=Confianza.calcular(puntaje, esquema.umbral_verde, esquema.umbral_amarillo),
            fuente=tokens_valor[0].fuente if tokens_valor else None,
            encontrado=True,
            validado=valido,
            observaciones=observaciones,
        )

    @staticmethod
    def _texto_a_la_derecha(texto_linea: str, etiqueta_match: str) -> str | None:
        idx = texto_linea.lower().find(etiqueta_match.lower())
        if idx == -1:
            return None
        resto = texto_linea[idx + len(etiqueta_match):].strip()
        return resto or None

    def extraer_detalle(self, lineas: list[Linea], esquema: EsquemaDocumento) -> list[LineaDetalle]:
        if esquema.detalle is None:
            return []
        detalle_def = esquema.detalle

        inicio = _buscar_ancla(lineas, (detalle_def.ancla_inicio,), 0, len(lineas))
        if inicio is None:
            return []

        # Entre el ancla de inicio y la primera fila de datos suele haber una
        # fila de encabezados de columna (ej. "TOTAL PRICE") que puede coincidir
        # por error con alguna ancla de fin (ej. "TOTAL"). Se evita esa ambigüedad
        # arrancando la tabla en la primera línea puramente numérica (la columna
        # "item" de la primera fila real), que nunca aparece en encabezados.
        inicio_datos = next(
            (i for i in range(inicio + 1, len(lineas)) if lineas[i].texto.strip().isdigit()),
            None,
        )
        if inicio_datos is None:
            return []

        fin = _buscar_ancla(lineas, detalle_def.ancla_fin, inicio_datos + 1, len(lineas))
        fin = fin if fin is not None else len(lineas)

        lineas_tabla = [lin for lin in lineas[inicio_datos:fin] if lin.texto.strip()]
        if not lineas_tabla:
            return []

        columnas_x = self._detectar_columnas(lineas_tabla, len(detalle_def.columnas))
        nombres_columna = [c.nombre for c in detalle_def.columnas]

        filas_celdas = self._agrupar_en_filas(lineas_tabla, columnas_x, nombres_columna)
        return [LineaDetalle(columnas=celdas) for celdas in filas_celdas if celdas]

    @staticmethod
    def _detectar_columnas(lineas_tabla: list[Linea], num_columnas_esperadas: int) -> list[float]:
        """Divide las posiciones x0 de las celdas de la tabla en exactamente
        `num_columnas_esperadas` grupos, cortando por los saltos de x0 más
        grandes. Esto es más robusto que un bucket de tolerancia fija cuando
        hay columnas de texto largo que envuelve a varias líneas con x0
        variable (el salto entre columnas reales sigue siendo mayor que la
        variación de x0 dentro de una misma columna envuelta)."""
        xs = sorted(lin.x0 for lin in lineas_tabla)
        num_cortes = min(num_columnas_esperadas - 1, len(xs) - 1)
        saltos = sorted(range(1, len(xs)), key=lambda i: xs[i] - xs[i - 1], reverse=True)
        cortes = set(saltos[:num_cortes])

        buckets: list[list[float]] = [[xs[0]]]
        for i in range(1, len(xs)):
            if i in cortes:
                buckets.append([xs[i]])
            else:
                buckets[-1].append(xs[i])
        return [sum(b) / len(b) for b in buckets]

    @staticmethod
    def _columna_de(x0: float, columnas_x: list[float]) -> int:
        return min(range(len(columnas_x)), key=lambda i: abs(columnas_x[i] - x0))

    def _agrupar_en_filas(
        self, lineas_tabla: list[Linea], columnas_x: list[float], nombres_columna: list[str]
    ) -> list[dict[str, str]]:
        idx_col_item = 0  # la primera columna (más a la izquierda) es "item" por definición del esquema
        anclas_fila = sorted(
            lin.y0
            for lin in lineas_tabla
            if self._columna_de(lin.x0, columnas_x) == idx_col_item and lin.texto.strip().isdigit()
        )
        if not anclas_fila:
            return []

        # Cada celda (incluidas las líneas envueltas de texto largo, que
        # pueden caer un poco por encima o por debajo de la ancla "item" de
        # su fila) se asigna a la fila cuya ancla de y0 esté más cerca.
        celdas_por_fila: list[dict[str, list[tuple[float, str]]]] = [dict() for _ in anclas_fila]
        for lin in lineas_tabla:
            col_idx = self._columna_de(lin.x0, columnas_x)
            if col_idx >= len(nombres_columna):
                continue
            idx_fila = min(range(len(anclas_fila)), key=lambda i: abs(anclas_fila[i] - lin.y0))
            nombre_col = nombres_columna[col_idx]
            celdas_por_fila[idx_fila].setdefault(nombre_col, []).append((lin.y0, lin.texto.strip()))

        filas: list[dict[str, str]] = []
        for celdas in celdas_por_fila:
            fila = {}
            for nombre_col, partes in celdas.items():
                partes.sort(key=lambda p: p[0])  # orden de lectura: arriba hacia abajo
                fila[nombre_col] = " ".join(t for _, t in partes)
            filas.append(fila)
        return filas
