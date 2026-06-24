"""CLI de prueba: ejecuta el pipeline de extracción sobre un archivo y muestra
el resultado en consola. Es el harness para verificar el motor antes de UI.

Uso:
    python -m extractor.adaptadores.entrada.cli <ruta_pdf> <tipo_documento> [--export salida.json|salida.csv]
"""

import argparse
import sys
from pathlib import Path

from extractor.adaptadores.salida.esquemas.yaml_repositorio import RepositorioEsquemasYaml
from extractor.adaptadores.salida.exportadores.csv_exportador import ExportadorCsv
from extractor.adaptadores.salida.exportadores.json_exportador import ExportadorJson
from extractor.adaptadores.salida.pdf.pymupdf_lector import LectorTextoPyMuPDF
from extractor.aplicacion.casos_uso.extraer_documento import ExtraerDocumentoUseCase

RAIZ_PROYECTO = Path(__file__).resolve().parents[3].parent
CARPETA_ESQUEMAS = RAIZ_PROYECTO / "schemas"


def _imprimir_resultado(resultado) -> None:
    print(f"\n=== {resultado.tipo_documento.upper()} — {resultado.archivo_origen} ===\n")
    print(f"{'CAMPO':<20} {'VALOR':<55} {'CONF.':>6}  {'NIVEL':<8} OBSERVACIONES")
    print("-" * 110)
    for nombre, campo in resultado.campos.items():
        valor = (campo.valor or "—")[:55]
        print(
            f"{nombre:<20} {valor:<55} {campo.confianza.puntaje:>5.0f}%  "
            f"{campo.confianza.nivel.value:<8} {'; '.join(campo.observaciones)}"
        )

    if resultado.detalle:
        print(f"\n--- Detalle ({len(resultado.detalle)} líneas) ---")
        for i, linea in enumerate(resultado.detalle, start=1):
            print(f"  [{i}] {linea.columnas}")

    print(f"\nTiene excepciones: {resultado.tiene_excepciones}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prototipo de extracción de documentos.")
    parser.add_argument("archivo", help="Ruta al PDF a procesar")
    parser.add_argument("tipo_documento", help="Tipo de documento (nombre del esquema YAML, sin extensión)")
    parser.add_argument("--export", help="Ruta de salida .json o .csv", default=None)
    args = parser.parse_args()

    lector_texto = LectorTextoPyMuPDF()
    repositorio_esquemas = RepositorioEsquemasYaml(str(CARPETA_ESQUEMAS))
    caso_uso = ExtraerDocumentoUseCase(
        lector_texto=lector_texto,
        motor_ocr=None,
        repositorio_esquemas=repositorio_esquemas,
    )

    resultado = caso_uso.ejecutar(args.archivo, args.tipo_documento)
    _imprimir_resultado(resultado)

    if args.export:
        if args.export.endswith(".json"):
            ruta = ExportadorJson().exportar(resultado, args.export)
        elif args.export.endswith(".csv"):
            ruta = ExportadorCsv().exportar(resultado, args.export)
        else:
            print("Formato de export no soportado (usar .json o .csv)", file=sys.stderr)
            sys.exit(1)
        print(f"\nExportado a: {ruta}")


if __name__ == "__main__":
    main()
