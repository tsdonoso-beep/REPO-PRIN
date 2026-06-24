# Extractor Documental

Aplicación de escritorio (local) para **extraer datos estructurados de documentos
contables** (órdenes de compra, facturas, documentos de comercio exterior, etc.)
y exportarlos a un archivo plano que el ERP pueda importar.

El objetivo es replicar la **funcionalidad de extracción** de plataformas SaaS de
automatización de cuentas por pagar, pero como herramienta local — sin costo
recurrente por documento procesado.

## Estado

🟡 **Fase de diseño.** Todavía no hay implementación. Este repositorio contiene
por ahora únicamente el diseño de arquitectura y los esquemas declarativos.

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — diseño de la arquitectura
  hexagonal, modelo de dominio, puertos/adaptadores y pipeline de extracción.
- [`schemas/`](schemas/) — esquemas declarativos por tipo de documento (qué
  campos extraer y cómo). Agregar un tipo de documento nuevo = agregar un YAML,
  sin tocar código.

## Stack previsto

- **UI:** PySide6 (escritorio, empaquetado con PyInstaller).
- **Extracción:** texto nativo de PDF (PyMuPDF) + OCR (Tesseract) para
  escaneos/fotos; LLM de visión como fallback opcional para layouts desconocidos.
- **Validación:** reglas declarativas + API de SUNAT + maestros internos
  (catálogo SIDIGE, proveedores).
- **Persistencia:** local (SQLite), opcional.

## Principios

Arquitectura hexagonal (puertos y adaptadores), SOLID y código limpio, de modo
que la tecnología (motor OCR, almacenamiento, UI, fuente de validación) se pueda
cambiar sin tocar el dominio.
