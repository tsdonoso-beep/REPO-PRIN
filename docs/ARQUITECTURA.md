# Arquitectura — Extractor Documental

> Documento de **diseño**. Define la estructura antes de escribir lógica.
> Objetivo del MVP: **extraer campos de un documento y exportarlos a archivo
> plano**, empezando por el tipo *Orden de Compra*.

---

## 1. Principio rector: hexagonal (puertos y adaptadores)

El **dominio** (reglas de negocio: qué es un documento, un campo extraído, cómo
se calcula la confianza) no conoce ni a PySide, ni a Tesseract, ni a SUNAT, ni a
SQLite. Todo lo externo entra y sale por **puertos** (interfaces), implementados
por **adaptadores** intercambiables.

```
        ENTRADA (driving)                        SALIDA (driven)
   ┌───────────────────────┐              ┌──────────────────────────┐
   │  UI PySide6           │              │  PyMuPDF (texto nativo)  │
   │  CLI (pruebas)        │              │  Tesseract (OCR)         │
   └──────────┬────────────┘              │  Cargador YAML (esquemas)│
              │ invoca casos de uso       │  SUNAT API (validación)  │
              ▼                           │  Catálogo SIDIGE         │
   ┌───────────────────────┐   usa        │  Exportador CSV/Excel    │
   │     APLICACIÓN         │─────────────▶│  SQLite (persistencia)   │
   │   (casos de uso)       │  puertos     └──────────────────────────┘
   └──────────┬────────────┘
              │ usa
              ▼
   ┌───────────────────────┐
   │       DOMINIO          │   ← puro, sin dependencias externas
   │  modelo + servicios    │
   └───────────────────────┘
```

**Beneficio concreto:** cambiar Tesseract por otro OCR, el Excel del catálogo
SIDIGE por una tabla en Supabase, o agregar un tipo de documento, **no toca el
dominio**. Es el principio Open/Closed: abierto a extensión, cerrado a
modificación.

---

## 2. Estructura de carpetas

```
.
├── README.md
├── pyproject.toml                 # dependencias (se define al empezar a codear)
├── docs/
│   └── ARQUITECTURA.md            # este documento
├── schemas/                       # ESQUEMAS declarativos por tipo (DATOS, no código)
│   └── orden_compra.yaml
├── src/
│   └── extractor/
│       ├── dominio/               # núcleo puro — sin imports de terceros
│       │   ├── modelo/            # entidades y objetos de valor
│       │   ├── puertos/           # interfaces (Protocol/ABC)
│       │   └── servicios/         # servicios de dominio (cruce de fuentes, scoring)
│       ├── aplicacion/
│       │   └── casos_uso/         # orquestación de los puertos
│       ├── adaptadores/
│       │   ├── entrada/           # driving: cli/, ui/ (PySide6)
│       │   └── salida/            # driven: pdf/, ocr/, esquemas/, validadores/,
│       │                          #         exportadores/, persistencia/
│       └── configuracion/         # composition root (inyección de dependencias)
└── tests/
    └── fixtures/
        └── orden_compra/          # PDFs de ejemplo + ground truth (valores correctos)
```

> Nomenclatura en español a propósito: el dominio del negocio es en español
> (factura, expediente, proveedor), y mantener el *lenguaje ubicuo* alineado con
> el negocio facilita la comunicación con los usuarios.

---

## 3. Modelo de dominio

### Entidades y objetos de valor

| Tipo | Elemento | Descripción |
|---|---|---|
| Entidad | `Documento` | Archivo cargado: id, tipo, ruta, nº de páginas, fecha de proceso. |
| Agregado | `ResultadoExtraccion` | Documento + campos de cabecera + líneas de detalle + estado (`validado` / `excepcion`). Es lo que la UI muestra y lo que se exporta. |
| Objeto de valor | `CampoExtraido` | `nombre`, `valor`, `confianza`, `fuente`, `validado`, `observaciones`. |
| Objeto de valor | `LineaDetalle` | Una fila de tabla (ej. un ítem de la OC con su código y precio). |
| Objeto de valor | `Confianza` | `puntaje` (0–100) + `nivel` (VERDE ≥90 / AMARILLO 70–89 / ROJO <70 o regla fallida). |
| Objeto de valor | `Fuente` (enum) | `TEXTO_NATIVO`, `OCR_TESSERACT`, `LLM_VISION`. |
| Objeto de valor | `Token` | Palabra detectada + bbox (x,y,w,h) + confianza OCR. Materia prima de la extracción. |
| Objeto de valor | `EsquemaDocumento` | Cargado desde YAML: lista de `DefinicionCampo` (cabecera) + `DefinicionTabla` (detalle) + reglas + identidad para duplicados. |
| Objeto de valor | `DefinicionCampo` | `nombre`, `etiquetas` (anclas), `tipo_dato`, `posicion`, `region`, `validacion`. |

### Servicio de dominio (lógica pura, sin IO)

`MotorExtraccion` — recibe los `Token` de cada fuente (entregados por los puertos)
y el `EsquemaDocumento`, y produce los `CampoExtraido`:

1. **Localiza el ancla** de cada campo (match difuso para tolerar errores de OCR).
2. **Toma el valor** según `posicion` (abajo / derecha / dentro de `region`).
3. **Cruza fuentes**: si ≥2 fuentes coinciden → confianza alta (consenso).
4. **Aplica reglas** (regex, formato fecha, checksum RUC) como árbitro.
5. **Calcula `Confianza`** combinando: confianza OCR + consenso + paso de
   validación + si se encontró el ancla.

`MotorExtraccion` no sabe leer PDFs ni llamar a Tesseract: recibe tokens ya
extraídos. Eso lo hace 100% testeable sin archivos ni red.

---

## 4. Puertos (interfaces)

### De salida (driven) — lo que el dominio necesita

| Puerto | Responsabilidad | Adaptador(es) |
|---|---|---|
| `LectorTextoPort` | PDF con capa de texto → `Token[]` con coordenadas | PyMuPDF |
| `MotorOcrPort` | Imagen → `Token[]` con bbox y confianza | Tesseract |
| `RepositorioEsquemasPort` | Cargar `EsquemaDocumento` por tipo | Cargador YAML |
| `ValidadorPort` | Validar un campo contra una fuente de verdad | Reglas, SUNAT, SIDIGE, Proveedores |
| `ExportadorPort` | `ResultadoExtraccion` → archivo plano | CSV, Excel, JSON |
| `RepositorioDocumentosPort` | Persistir/consultar resultados (duplicados) | SQLite (opcional MVP) |

### De entrada (driving) — lo que dispara la app

| Puerto | Responsabilidad |
|---|---|
| `ExtraerDocumentoPort` | Caso de uso: (archivo, tipo) → `ResultadoExtraccion` |
| `ExportarResultadoPort` | Caso de uso: `ResultadoExtraccion` → archivo |

---

## 5. Casos de uso (aplicación)

### `ExtraerDocumentoUseCase`
```
entrada: ruta_archivo, tipo_documento
1. cargar EsquemaDocumento (RepositorioEsquemasPort)
2. normalizar entrada:
     - ¿PDF con texto nativo?  → LectorTextoPort         (fuente TEXTO_NATIVO)
     - ¿imagen / PDF escaneado? → rasterizar + MotorOcrPort (fuente OCR_TESSERACT)
3. MotorExtraccion.extraer(tokens_por_fuente, esquema) → CampoExtraido[]
4. validar cada campo (ValidadorPort según esquema)
5. detectar duplicado (RepositorioDocumentosPort, por identidad del esquema)
6. construir ResultadoExtraccion (estado validado / excepcion)
salida: ResultadoExtraccion
```

### `ExportarResultadoUseCase`
```
entrada: ResultadoExtraccion, formato
1. mapear a estructura de columnas (según config de export)
2. ExportadorPort.exportar(...) → archivo plano
salida: ruta del archivo generado
```

---

## 6. Pipeline de extracción (resumen)

```
Archivo (PDF/imagen)
   │
   ├─ ¿texto nativo? ──sí──▶ LectorTexto ─┐
   │                                       ├─▶ MotorExtraccion ─▶ validación ─▶ ResultadoExtraccion
   └─ no ─▶ rasterizar ─▶ Tesseract ──────┘     (cruce + scoring)   (reglas+SUNAT     │
                                                                      +SIDIGE)         ▼
                                                                                 Exportador → archivo plano
```

**Cascada de costo (barato → caro):** texto nativo / Tesseract primero (local,
gratis). El LLM de visión solo se invoca para campos donde las fuentes locales
discrepan o quedan en baja confianza. Así la app es mayormente offline y sin
costo por documento.

---

## 7. Decisiones abiertas (a validar antes de codear)

1. **Persistencia en el MVP**: ¿incluimos SQLite desde el inicio (habilita
   detección de duplicados e historial) o el MVP es sin estado y solo exporta?
2. **Formato de export por defecto**: ¿Excel (.xlsx), CSV o JSON? Depende de qué
   espera importar el ERP de Inroprin.
3. **Validación SUNAT en OC**: en órdenes de compra el proveedor puede ser
   extranjero (sin RUC), por lo que SUNAT aporta poco aquí; la validación fuerte
   es contra el **maestro SIDIGE**. ¿Confirmamos dejar SUNAT para los tipos
   *Factura* y validar OC solo con maestros internos?
4. **Nomenclatura del código**: dominio en español (propuesto). Confirmar.
