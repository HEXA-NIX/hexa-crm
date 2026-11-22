# Proveedores de almacenamiento documental

Hexa separa la ficha documental del proveedor físico. Los proyectos conservan
referencias y notas, mientras que cada proveedor se ocupa de subir el fichero y
devolver una URL estable. Google Drive es el primer proveedor; el contrato está
preparado para incorporar S3/MinIO, WebDAV/Nextcloud o almacenamiento local.

## Google Drive

### Preparación del operador de Hexa

1. Crea o selecciona un proyecto en Google Cloud Console.
2. Activa **Google Drive API**.
3. Configura la pantalla de consentimiento OAuth.
4. Crea un cliente OAuth de tipo web y autoriza el alcance
   `https://www.googleapis.com/auth/drive.file`.
5. Registra como redirección autorizada
   `https://TU_CRM/api/storage/google-drive/callback`.
6. Configura `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`,
   `GOOGLE_DRIVE_REDIRECT_URI` y `HEXA_MASTER_ENCRYPTION_KEY` en los secretos del
   servidor. Estos datos pertenecen al operador y nunca se solicitan al cliente.

### Configuración en Hexa

1. Entra como administrador y selecciona la empresa correcta.
2. Abre **Ajustes → Plugins → Google Drive**.
3. Activa el proveedor y pulsa **Conectar con Google**.
4. Inicia sesión y acepta el permiso una sola vez. Hexa guarda cifrado el token
   de renovación y obtiene nuevos tokens de acceso automáticamente.
5. Indica opcionalmente el ID de carpeta y guarda la configuración.
6. En la ficha de un proyecto, abre **Documentación**, elige un fichero y pulsa
   **Subir a Google Drive**. Después guarda la documentación para vincularlo.

La autorización persistente se cifra mediante AES-256-GCM y se guarda en una
cookie `HttpOnly`, por lo que JavaScript de la interfaz no puede leerla. El token
nunca se añade a la URL, al documento del proyecto ni a los registros de auditoría.

## Límites actuales

- Tamaño máximo por fichero: 20 MB. La interfaz muestra el tamaño seleccionado y los errores de subida dentro del formulario.
- El operador debe registrar previamente la aplicación OAuth oficial de Hexa.
- Hexa crea el fichero con los permisos del usuario OAuth. Compartirlo con otras
  personas se gestiona actualmente desde Google Drive.
- Si la subida termina pero no se guarda el formulario documental, el archivo
  queda en Drive sin referencia en el proyecto.

## Contrato para nuevos proveedores

Un proveedor debe validar su configuración, probar la conexión y aceptar nombre,
MIME y bytes. Debe devolver como mínimo identificador remoto, URL web, nombre,
MIME y tamaño. La UI no debe conocer detalles internos del SDK o API utilizado.
