<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";

  type KindOption = { value: string; label: string };
  type Company = { id: number; name: string; logo_data_url?: string };
  type UploadData = {
    title: string;
    description: string;
    expires_at: string;
    caption: string;
    preview: { data_url: string; mime_type: string; name: string };
    companies: Company[];
    selected_company_id: number | null;
    kind_options: KindOption[];
  };

  let loading = $state(true);
  let saving = $state(false);
  let error = $state("");
  let success = $state(false);
  let data = $state<UploadData | null>(null);
  let kind = $state("invoice");
  let companyId = $state<number | null>(null);
  let { data: pageMeta } = $props<{ data: { public_url: string } }>();

  function token() {
    return encodeURIComponent($page.params.token ?? "");
  }

  function formatExpiry(value: string) {
    if (!value) return "Enlace temporal";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Enlace temporal" : `Disponible hasta las ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
  }

  const selectedCompany = $derived(data?.companies.find((company) => company.id === companyId) ?? (data?.companies.length === 1 ? data.companies[0] : null));

  async function load() {
    loading = true;
    error = "";
    try {
      const response = await fetch(`/api/whatsapp/upload/${token()}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Este enlace ya no está disponible.");
      data = body as UploadData;
      kind = data.kind_options.find((option) => option.value === "invoice")?.value ?? data.kind_options[0]?.value ?? "invoice";
      companyId = data.selected_company_id ?? (data.companies.length === 1 ? data.companies[0].id : null);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No se pudo abrir el documento.";
    } finally {
      loading = false;
    }
  }

  async function confirm() {
    if (!data || saving || !kind || (data.companies.length > 1 && companyId == null)) return;
    saving = true;
    error = "";
    try {
      const response = await fetch(`/api/whatsapp/upload/${token()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, company_id: companyId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "No se pudo guardar el documento.");
      success = true;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "No se pudo guardar el documento.";
    } finally {
      saving = false;
    }
  }

  onMount(load);
</script>

<svelte:head>
  <title>Revisar documento · Hexa</title>
  <meta name="description" content="Confirma el tipo de documento para completar su registro en Hexa." />
  <meta name="robots" content="noindex,nofollow,noarchive" />
  <meta property="og:title" content="Revisar documento en Hexa" />
  <meta property="og:description" content="Confirma el tipo de documento para completar su registro." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={`${pageMeta.public_url}/recibir/${$page.params.token}`} />
  <!-- PNG keeps previews compatible with WhatsApp clients that ignore SVG OG images. -->
  <meta property="og:image" content={`${pageMeta.public_url}/logo-mark.png`} />
</svelte:head>

<main class="upload-shell">
  <div class="upload-brand">
    {#if selectedCompany?.logo_data_url}
      <img src={selectedCompany.logo_data_url} alt={selectedCompany.name} class="upload-company-logo" />
    {:else}
      <span class="upload-mark">N</span>
    {/if}
    <span>{selectedCompany?.name ?? "HEXA"}</span>
  </div>
  <section class="upload-card" aria-labelledby="upload-title">
    {#if loading}
      <div class="upload-loading" aria-live="polite"><span class="upload-spinner"></span><p>Abriendo tu documento…</p></div>
    {:else if success}
      <div class="upload-result" aria-live="polite">
        <div class="upload-result-icon">✓</div>
        <h1>Documento recibido</h1>
        <p>Ya está guardado en Gastos y facturas para su revisión.</p>
        <small>Puedes cerrar esta ventana y volver a WhatsApp.</small>
      </div>
    {:else if error}
      <div class="upload-result" aria-live="assertive">
        <div class="upload-result-icon upload-result-icon-error">!</div>
        <h1>Enlace no disponible</h1>
        <p>{error}</p>
        <small>Solicita un nuevo enlace enviando otra vez el documento por WhatsApp.</small>
      </div>
    {:else if data}
      <div class="upload-heading">
        <p class="upload-kicker">DOCUMENTO DE WHATSAPP</p>
        <h1 id="upload-title">{data.title}</h1>
        <p>{data.description}</p>
      </div>
      <div class="upload-preview">
        {#if data.preview.mime_type.startsWith("image/")}
          <img src={data.preview.data_url} alt="Documento recibido" />
        {:else}
          <div class="upload-file-icon">PDF</div>
          <strong>{data.preview.name}</strong>
        {/if}
      </div>
      {#if data.caption}<p class="upload-caption">“{data.caption}”</p>{/if}
      {#if data.companies.length > 1}
        <fieldset class="upload-fieldset"><legend>Empresa</legend><div class="upload-options upload-company-options">
          {#each data.companies as company}
            <label class:selected={companyId === company.id}><input type="radio" name="company" value={company.id} bind:group={companyId} /> <span>{company.name}</span></label>
          {/each}
        </div></fieldset>
      {/if}
      <fieldset class="upload-fieldset"><legend>¿Qué has enviado?</legend><div class="upload-options">
        {#each data.kind_options as option}
          <label class:selected={kind === option.value}><input type="radio" name="kind" value={option.value} bind:group={kind} /> <span>{option.label}</span></label>
        {/each}
      </div></fieldset>
      <p class="upload-expiry">{formatExpiry(data.expires_at)} · Solo se puede usar una vez</p>
      <button class="upload-submit" type="button" disabled={saving || (data.companies.length > 1 && companyId == null)} onclick={confirm}>{saving ? "Guardando…" : "Confirmar y guardar"}</button>
      {#if error}<p class="upload-inline-error" role="alert">{error}</p>{/if}
    {/if}
  </section>
  <p class="upload-footer">Registro seguro de documentos · Hexa</p>
</main>

<style>
  .upload-shell { min-height:100dvh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1rem; padding:1.5rem; color:#202532; background:radial-gradient(circle at 50% -10%,#e9ddff 0,#f7f8fb 42%,#eef1f6 100%); font-family:var(--font-sans); }
  .upload-brand { display:flex; align-items:center; gap:.55rem; max-width:min(100%,30rem); color:#262b39; font-size:.78rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
  .upload-company-logo { width:2.2rem; height:2.2rem; flex:0 0 auto; border:1px solid #9c63dc; border-radius:.65rem; object-fit:contain; background:linear-gradient(145deg,#1c132a,#0e0b16); box-shadow:0 0 16px #8b5cf633; }
  .upload-mark { display:grid; width:2rem; height:2rem; place-items:center; border-radius:.65rem; color:white; background:linear-gradient(135deg,#6f35b5,#9b63e4); box-shadow:0 6px 18px #7c4bd155; font-family:Georgia,serif; font-size:1.2rem; letter-spacing:0; }
  .upload-card { width:min(100%,30rem); border:1px solid #dfe3eb; border-radius:1.25rem; background:#fff; padding:1.5rem; box-shadow:0 20px 55px #252b3b1c; }
  .upload-heading { text-align:center; } .upload-kicker { margin:0 0 .5rem; color:#7650ad; font-size:.67rem; font-weight:800; letter-spacing:.16em; } h1 { margin:0; font-size:1.55rem; } .upload-heading p:last-child { margin:.5rem 0 0; color:#687386; font-size:.9rem; }
  .upload-preview { display:flex; min-height:8rem; align-items:center; justify-content:center; margin:1.35rem 0 .5rem; overflow:hidden; border:1px solid #e2e6ed; border-radius:.9rem; background:#f4f6f9; } .upload-preview img { display:block; max-height:17rem; max-width:100%; object-fit:contain; } .upload-file-icon { margin-right:.75rem; border-radius:.45rem; background:#e85268; color:#fff; padding:.55rem; font-size:.7rem; font-weight:800; } .upload-caption { margin:.4rem 0 1rem; color:#707b8c; font-size:.8rem; text-align:center; }
  .upload-fieldset { margin:1.1rem 0 0; padding:0; border:0; } legend { margin-bottom:.55rem; color:#3c4554; font-size:.83rem; font-weight:700; } .upload-options { display:grid; gap:.5rem; } .upload-options label { display:flex; align-items:center; gap:.65rem; cursor:pointer; border:1px solid #e1e5ec; border-radius:.7rem; padding:.7rem .8rem; color:#4c5768; font-size:.9rem; transition:.15s; } .upload-options label.selected { border-color:#8655c6; background:#f2ecfb; color:#4f2b78; } .upload-options input { accent-color:#7540b4; } .upload-company-options { grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); }
  .upload-expiry { margin:.9rem 0; color:#8791a0; font-size:.73rem; text-align:center; } .upload-submit { width:100%; border:0; border-radius:.7rem; padding:.78rem 1rem; color:#fff; background:#7240b2; font-weight:700; cursor:pointer; box-shadow:0 8px 18px #7240b233; } .upload-submit:disabled { cursor:not-allowed; opacity:.55; } .upload-inline-error { margin:.65rem 0 0; color:#bd3d56; font-size:.8rem; text-align:center; }
  .upload-loading,.upload-result { display:flex; min-height:20rem; flex-direction:column; align-items:center; justify-content:center; gap:.75rem; text-align:center; } .upload-result p { margin:0; color:#687386; } .upload-result small { color:#8a94a3; } .upload-result-icon { display:grid; width:3.2rem; height:3.2rem; place-items:center; border-radius:50%; color:#fff; background:#17a673; font-size:1.7rem; font-weight:800; } .upload-result-icon-error { background:#d45268; } .upload-spinner { width:2rem; height:2rem; border:.22rem solid #e2d6f3; border-top-color:#7540b4; border-radius:50%; animation:spin .8s linear infinite; } .upload-footer { margin:0; color:#7f8a9b; font-size:.72rem; } @keyframes spin { to { transform:rotate(360deg); } }
  @media (max-width:480px) { .upload-shell { padding:1rem; } .upload-card { padding:1.15rem; } }
</style>
