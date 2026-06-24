import csv

from extractor.dominio.modelo import ResultadoExtraccion


class ExportadorCsv:
    """Exporta el detalle (una fila por ítem) con los campos de cabecera
    repetidos en cada fila, listo para que un ERP lo importe como archivo plano."""

    def exportar(self, resultado: ResultadoExtraccion, ruta_salida: str) -> str:
        encabezados_cabecera = list(resultado.campos.keys())
        columnas_detalle = list(resultado.detalle[0].columnas.keys()) if resultado.detalle else []

        with open(ruta_salida, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(encabezados_cabecera + columnas_detalle)

            filas = resultado.detalle or [None]
            for fila in filas:
                valores_cabecera = [resultado.campos[c].valor or "" for c in encabezados_cabecera]
                valores_detalle = [fila.columnas.get(c, "") for c in columnas_detalle] if fila else []
                writer.writerow(valores_cabecera + valores_detalle)

        return ruta_salida
