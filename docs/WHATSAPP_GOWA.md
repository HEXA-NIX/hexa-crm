# WhatsApp mediante GOWA

Hexa CRM integra GOWA como pasarela autohospedada de WhatsApp Web. No utiliza la API oficial de Meta. Cada empresa vincula un teléfono mediante QR; internamente el dispositivo conserva un identificador `hexa-{empresa}-{usuario}` para auditoría.

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
- También puedes usar «Gastos y facturas → Leer WhatsApp»: Hexa consulta los chats con multimedia, descarga la última foto/documento y ejecuta visión con `HEXA_OLLAMA_URL`/`HEXA_OLLAMA_MODEL` (por defecto `llama3.2-vision`). El resultado siempre queda pendiente de revisión humana.
- Con el webhook activo no hace falta pulsar ningún botón. El teléfono receptor determina la empresa. Si el mismo número está vinculado a varias empresas, Hexa pregunta primero el destino por WhatsApp; si solo hay una, la selecciona directamente. Después envía una encuesta para elegir el tipo (ticket, factura, factura simplificada, abono o justificante), descarga y analiza el documento. La instalación de producción usa el parche versionado `patches/gowa/0002-forward-poll-vote.patch`, que descifra la respuesta y la reenvía al webhook; si el endpoint de encuestas no está disponible, Hexa conserva un fallback textual. El botón manual queda como respaldo si el webhook no está expuesto.
- La recepción preferente envía un enlace público temporal en `HEXA_PUBLIC_APP_URL/recibir/<token>`. El token es aleatorio, no contiene empresa/teléfono/ID, solo se guarda su hash SHA-256, caduca a los 30 minutos y se invalida al confirmar. La página no requiere iniciar sesión, muestra la imagen y permite escoger el tipo y la empresa; el HTML incluye Open Graph para que WhatsApp muestre un título e imagen genéricos. Configura `HEXA_PUBLIC_APP_URL` con el dominio HTTPS real accesible desde Internet (nunca `localhost` ni una IP privada en producción). Si falta o no está disponible, se mantiene la encuesta como fallback.
- Por seguridad, el remitente también debe ser un usuario activo de Hexa con teléfono guardado y pertenecer a la empresa receptora. Un número no registrado no recibe respuesta y no deja ningún registro pendiente.
- Cada envío exige confirmación humana y queda registrado en auditoría.
- La primera versión solo permite mensajes individuales de texto, hasta 4.000 caracteres.
- No se permiten campañas masivas. Al depender de WhatsApp Web, Meta puede cerrar sesiones o limitar números.
- Para mensajería transaccional de gran volumen debe añadirse WhatsApp Business Platform como proveedor oficial alternativo.
