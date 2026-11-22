# VERI*FACTU en Hexa CRM

Esta fase prepara el sistema para VERI*FACTU, pero no declara todavía que el producto esté homologado ni remite registros automáticamente a la AEAT.

## Qué incorpora

- Configuración por empresa en `Impuestos → Perfil fiscal → VERI*FACTU`.
- Modos `Desactivado`, `Pruebas AEAT` y `Producción (pendiente de conexión)`.
- Registro de alta al emitir una factura y registro de anulación al anularla.
- Encadenamiento por empresa y huella SHA-256 con el formato de campos publicado por la AEAT.
- URL del QR tributario para pruebas o producción y QR visual en la impresión de la factura.
- Comprobación de la cadena y exportación JSON de los registros.

## Qué queda para la siguiente fase

- Conexión SOAP/XML con los servicios de remisión de la AEAT.
- Certificado o mecanismo de identificación autorizado y gestión segura de renovaciones.
- Reintentos, acuse de recibo, estados `Aceptado`, `Aceptado con errores` y `Rechazado`.
- Declaración responsable del productor y revisión final con asesoría fiscal.

La cadena se mantiene separada por empresa. No se deben editar ni borrar registros ya generados; una corrección debe producir el registro fiscal que corresponda.

Referencias oficiales:

- [Preguntas frecuentes de la AEAT sobre VERI*FACTU](https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes/procedimientos-facturacion.html)
- [Especificación del hash SHA-256](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/Veri-Factu_especificaciones_huella_hash_registros.pdf)
- [Especificación del QR y URL de cotejo](https://www.agenciatributaria.es/static_files/AEAT_Desarrolladores/EEDD/IVA/VERI-FACTU/DetalleEspecificacTecnCodigoQRfactura.pdf)
