# GOWA local patch set

`0001-add-send-list.patch` is based on the GOWA source used to build the
server binary (v3.4.0). It adds a legacy WhatsApp list-message endpoint:

```http
POST /send/list
X-Device-Id: hexa-2-1
Content-Type: application/json

{
  "phone": "34600000000@s.whatsapp.net",
  "title": "La Sirena",
  "description": "Selecciona una opción",
  "button_text": "Opciones",
  "rows": [{"id":"ticket","title":"Ticket"}]
}
```

The patch is intentionally not installed over the production GOWA binary
until it has been tested with the linked WhatsApp account. Rebuild from a
pinned upstream checkout, run `go test ./ui/rest ./usecase`, then replace the
 binary and restart `hexa-gowa.service` during a maintenance window.

`0002-forward-poll-vote.patch` is based on upstream v9.0.1. It decrypts
WhatsApp `PollUpdateMessage` values and forwards the selected option hashes in
the normal `message` webhook. Hexa maps those hashes to the document options
it sent. Build it from `src/` with Go 1.25.5 or newer, run the WhatsApp
infrastructure tests, and keep the previous binary available for rollback.
