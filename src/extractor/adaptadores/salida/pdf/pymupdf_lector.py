import fitz  # PyMuPDF

from extractor.dominio.modelo import Fuente, Linea, Token

# Tolerancia para encadenar celdas en una misma fila visual: el jitter típico
# entre una etiqueta y su valor en el mismo renglón es <4pt; el salto a la
# siguiente fila real (incluso con texto envuelto a varias líneas) es >8pt.
TOLERANCIA_FILA_VISUAL = 5.0


class LectorTextoPyMuPDF:
    """Extrae texto nativo (no escaneado) de un PDF y lo agrupa en líneas."""

    UMBRAL_CHARS_PARA_TEXTO_NATIVO = 20

    def tiene_texto_nativo(self, ruta_archivo: str) -> bool:
        with fitz.open(ruta_archivo) as doc:
            total = sum(len(pagina.get_text().strip()) for pagina in doc)
        return total >= self.UMBRAL_CHARS_PARA_TEXTO_NATIVO

    def leer_lineas(self, ruta_archivo: str) -> list[Linea]:
        lineas: list[Linea] = []
        with fitz.open(ruta_archivo) as doc:
            for num_pagina, pagina in enumerate(doc):
                lineas.extend(self._lineas_de_pagina(pagina, num_pagina))
        return lineas

    def _lineas_de_pagina(self, pagina, num_pagina: int) -> list[Linea]:
        # "words" devuelve (x0, y0, x1, y1, texto, block_no, line_no, word_no).
        # PyMuPDF agrupa por (block_no, line_no) cada fragmento de texto que
        # comparte un mismo renglón *dentro de su celda*, pero distintas celdas
        # de una misma fila visual (ej. "Razón Social:" y su valor a la derecha,
        # o "Etiqueta:"/"Valor:" en dos columnas) caen en (block,line) distintos
        # y con un y0 que difiere unas décimas de punto por baseline. Por eso no
        # se puede ordenar solo por y0 exacto: hay que agrupar primero en filas
        # visuales (tolerantes a ese jitter) y luego ordenar por x0 dentro de
        # cada fila.
        palabras = pagina.get_text("words")
        celdas: dict[tuple[int, int], list] = {}
        for x0, y0, x1, y1, texto, bloque, num_linea, _num_palabra in palabras:
            clave = (bloque, num_linea)
            celdas.setdefault(clave, []).append((x0, y0, x1, y1, texto))

        cajas = []  # (y0_repr, x0_repr, palabras_de_la_celda)
        for palabras_celda in celdas.values():
            palabras_celda.sort(key=lambda p: p[0])
            y0_repr = min(p[1] for p in palabras_celda)
            x0_repr = min(p[0] for p in palabras_celda)
            cajas.append((y0_repr, x0_repr, palabras_celda))
        cajas.sort(key=lambda c: c[0])

        filas: list[list] = []
        for caja in cajas:
            if filas and caja[0] - filas[-1][-1][0] <= TOLERANCIA_FILA_VISUAL:
                filas[-1].append(caja)
            else:
                filas.append([caja])

        lineas: list[Linea] = []
        for fila in filas:
            fila.sort(key=lambda c: c[1])  # orden por x0, izquierda a derecha
            for _, _, palabras_celda in fila:
                tokens = tuple(
                    Token(
                        texto=texto,
                        x0=x0,
                        y0=y0,
                        x1=x1,
                        y1=y1,
                        pagina=num_pagina,
                        fuente=Fuente.TEXTO_NATIVO,
                        confianza_ocr=100.0,
                    )
                    for x0, y0, x1, y1, texto in palabras_celda
                )
                lineas.append(Linea(tokens=tokens))

        return lineas
