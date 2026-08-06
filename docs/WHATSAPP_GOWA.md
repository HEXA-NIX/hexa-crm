# WhatsApp mediante GOWA

Hexa CRM integra GOWA como pasarela autohospedada de WhatsApp Web. No utiliza la API oficial de Meta. Cada combinación empresa/usuario dispone de un dispositivo independiente (`hexa-{empresa}-{usuario}`) y debe vincularse mediante QR.

En desarrollo con almacenamiento local, el servidor deriva un identificador opaco del token aleatorio de la sesión. Así se puede probar sin PostgreSQL y sin revelar el token ni acceder al dispositivo de otra sesión. Al cerrar sesión habrá que volver a vincular WhatsApp; este puente no sustituye el aislamiento central de producción.

## Infraestructura

Despliega [GOWA](https://github.com/aldinokemal/go-whatsapp-web-multidevice) en una red privada, con almacenamiento persistente y autenticación básica. No publiques su puerto directamente en Internet.

Configura Hexa CRM:

```env
GOWA_BASE_URL=http://gowa:3000
GOWA_USERNAME=usuario_interno
GOWA_PASSWORD=secreto_largo
```

Reinicia Hexa CRM después de modificar el entorno. En `Ajustes → WhatsApp`, cada usuario escanea su propio QR desde WhatsApp o WhatsApp Business: `Dispositivos vinculados → Vincular dispositivo`.

## Seguridad y operación

- El teléfono se guarda en formato internacional y nunca se usa como credencial.
- Las credenciales de GOWA solo se leen en el servidor; no llegan al navegador.
- Para recibir tickets y facturas, configura `WHATSAPP_WEBHOOK=https://tu-crm.example/api/whatsapp/webhook`, `WHATSAPP_WEBHOOK_EVENTS=message`, `WHATSAPP_AUTO_DOWNLOAD_MEDIA=true` y el mismo secreto en `GOWA_WEBHOOK_SECRET`/`WHATSAPP_WEBHOOK_SECRET`. Hexa crea un borrador en Gastos y facturas; nunca lo contabiliza sin aprobación.
- Cada envío exige confirmación humana y queda registrado en auditoría.
- La primera versión solo permite mensajes individuales de texto, hasta 4.000 caracteres.
- No se permiten campañas masivas. Al depender de WhatsApp Web, Meta puede cerrar sesiones o limitar números.
- Para mensajería transaccional de gran volumen debe añadirse WhatsApp Business Platform como proveedor oficial alternativo.
