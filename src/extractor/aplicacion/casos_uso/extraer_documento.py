from extractor.dominio.modelo import ResultadoExtraccion
from extractor.dominio.puertos import LectorTextoPort, MotorOcrPort, RepositorioEsquemasPort
from extractor.dominio.servicios.motor_extraccion import MotorExtraccion


class ExtraerDocumentoUseCase:
    def __init__(
        self,
        lector_texto: LectorTextoPort,
        motor_ocr: MotorOcrPort | None,
        repositorio_esquemas: RepositorioEsquemasPort,
        motor_extraccion: MotorExtraccion | None = None,
    ):
        self._lector_texto = lector_texto
        self._motor_ocr = motor_ocr
        self._repositorio_esquemas = repositorio_esquemas
        self._motor = motor_extraccion or MotorExtraccion()

    def ejecutar(self, ruta_archivo: str, tipo_documento: str) -> ResultadoExtraccion:
        esquema = self._repositorio_esquemas.cargar(tipo_documento)

        if self._lector_texto.tiene_texto_nativo(ruta_archivo):
            lineas = self._lector_texto.leer_lineas(ruta_archivo)
        elif self._motor_ocr is not None:
            lineas = self._motor_ocr.reconocer_lineas(ruta_archivo)
        else:
            raise RuntimeError(
                "El documento no tiene texto nativo y no hay motor OCR configurado."
            )

        campos = self._motor.extraer_campos(lineas, esquema)
        detalle = self._motor.extraer_detalle(lineas, esquema)

        return ResultadoExtraccion(
            tipo_documento=esquema.tipo,
            archivo_origen=ruta_archivo,
            campos=campos,
            detalle=detalle,
        )
