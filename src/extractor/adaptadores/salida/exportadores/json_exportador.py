import json

from extractor.dominio.modelo import ResultadoExtraccion


class ExportadorJson:
    def exportar(self, resultado: ResultadoExtraccion, ruta_salida: str) -> str:
        data = {
            "tipo_documento": resultado.tipo_documento,
            "archivo_origen": resultado.archivo_origen,
            "es_duplicado": resultado.es_duplicado,
            "tiene_excepciones": resultado.tiene_excepciones,
            "campos": {
                nombre: {
                    "valor": c.valor,
                    "confianza": c.confianza.puntaje,
                    "nivel": c.confianza.nivel.value,
                    "encontrado": c.encontrado,
                    "validado": c.validado,
                    "observaciones": c.observaciones,
                }
                for nombre, c in resultado.campos.items()
            },
            "detalle": [linea.columnas for linea in resultado.detalle],
        }
        with open(ruta_salida, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return ruta_salida
