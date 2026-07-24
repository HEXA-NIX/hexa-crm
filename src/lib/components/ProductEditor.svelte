<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { api } from "$lib/api/client";
  import { showToast } from "$lib/stores/ui";
  import { formatEUR, parseEurosInput } from "$lib/money";
  import { VAT_RATES, vatLabel, type VatRate } from "$lib/vat";
  import {
    LEGACY_SUPPLIER,
    NO_SUPPLIER,
    productSupplierSelection,
    supplierSnapshotForSelection,
  } from "$lib/inventory/supplier-selection";
  import type {
    FulfillmentMode,
    Product,
    ProductCondition,
    ProductInput,
    PublicationStatus,
    SalesPolicy,
    Supplier,
    SupplierSourceStatus,
    SupplyStatus,
  } from "$lib/types";
  import Button from "$lib/components/Button.svelte";
  import Card from "$lib/components/Card.svelte";
  import Input from "$lib/components/Input.svelte";
  import Select from "$lib/components/Select.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";

  let { productId }: { productId?: number } = $props();

  let loading = $state(true);
  let saving = $state(false);
  let notFound = $state(false);
  let product = $state<Product | null>(null);
  let suppliers = $state<Supplier[]>([]);

  // Form state
  let form = $state({
    sku: "",
    name: "",
    description: "",
    category: "",
    stock: "0",
    min_stock: "5",
    cost: "",
    price: "",
    vat_rate: "21" as string,
    supplier_name: "",
    supplier_contact: "",
    supplier_email: "",
    supplier_phone: "",
    fulfillment_mode: "own_stock" as FulfillmentMode,
    stock_location: "Almacén principal",
    condition_code: "new" as ProductCondition,
    publication_status: "draft" as PublicationStatus,
    sales_policy: "not_sellable" as SalesPolicy,
    supplier_source_status: "not_applicable" as SupplierSourceStatus,
    supply_status: "not_applicable" as SupplyStatus,
    supplier_last_verified_at: "",
    availability_eta: "",
  });

  // Supplier dropdown selection
  let selectedSupplier = $state(NO_SUPPLIER);

  // Small modal for creating a new supplier directly from product editor
  let supplierModal = $state(false);
  let savingSupplier = $state(false);
  let supplierForm = $state({
    name: "",
    contact: "",
    email: "",
    phone: "",
    ordering_method: "email",
    notes: "",
  });

  const fulfillmentOptions = [
    { value: "own_stock", label: "Stock propio (almacén local)" },
    { value: "supplier_dropship", label: "Dropshipping proveedor" },
    { value: "third_party_fulfillment", label: "Logística 3PL" },
    { value: "make_to_order", label: "Bajo pedido / producción" },
    { value: "digital_or_service", label: "Digital / Servicio" },
  ];

  const conditionOptions = [
    { value: "new", label: "Nuevo" },
    { value: "open_box", label: "Desprecintado / Open Box" },
    { value: "refurbished", label: "Reacondicionado" },
    { value: "used", label: "Usado / Segunda mano" },
    { value: "for_parts", label: "Para piezas / averiado" },
  ];

  const publicationStatusOptions = [
    { value: "draft", label: "Borrador (interno)" },
    { value: "published", label: "Publicado (visible y vendible)" },
    { value: "archived", label: "Archivado (descatalogado)" },
  ];

  const salesPolicyOptions = [
    { value: "not_sellable", label: "No vendible (solo borrador/catálogo)" },
    { value: "own_stock", label: "Stock propio (descuenta existencia local)" },
    { value: "dropship", label: "Dropshipping (envía proveedor sin stock local)" },
    { value: "preorder", label: "Preventa (con fecha ETA)" },
    { value: "make_to_order", label: "Bajo pedido (fabricación / encargo)" },
  ];

  const supplierSourceStatusOptions = [
    { value: "not_applicable", label: "No aplica" },
    { value: "negotiating", label: "En negociación / búsqueda" },
    { value: "approved", label: "Aprobado / tarifa verificada" },
    { value: "suspended", label: "Suspendido / sin suministro" },
  ];

  const supplyStatusOptions = [
    { value: "not_applicable", label: "Sin pedido activo / Estándar" },
    { value: "negotiating", label: "En negociación de suministro" },
    { value: "ordered", label: "Pedido confirmado a proveedor" },
    { value: "in_transit", label: "En tránsito hacia almacén 🚚" },
    { value: "received", label: "Recibido en almacén (pendiente publicación)" },
    { value: "quality_hold", label: "Cuarentena / Control de calidad" },
  ];

  const activeSuppliers = $derived(suppliers.filter((s) => s.active !== false));
  const selectedSupplierRecord = $derived(
    suppliers.find((s) => String(s.id) === selectedSupplier),
  );

  const supplierOptions = $derived([
    { value: NO_SUPPLIER, label: "Sin proveedor asignado" },
    ...activeSuppliers.map((s) => ({ value: String(s.id), label: s.name })),
    ...(selectedSupplier === LEGACY_SUPPLIER
      ? [{ value: LEGACY_SUPPLIER, label: `Histórico: ${form.supplier_name || "Proveedor sin guardar"}` }]
      : []),
  ]);

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    loading = true;
    try {
      const supList = await api.listSuppliers();
      suppliers = supList;

      if (productId) {
        const prodList = await api.listProducts(false);
        const p = prodList.find((item) => item.id === productId);
        if (!p) {
          notFound = true;
        } else {
          product = p;
          form = {
            sku: p.sku,
            name: p.name,
            description: p.description,
            category: p.category || "",
            stock: String(p.stock),
            min_stock: String(p.min_stock),
            cost: (p.cost_cents / 100).toFixed(2),
            price: (p.price_cents / 100).toFixed(2),
            vat_rate: String(p.vat_rate),
            supplier_name: p.supplier_name ?? "",
            supplier_contact: p.supplier_contact ?? "",
            supplier_email: p.supplier_email ?? "",
            supplier_phone: p.supplier_phone ?? "",
            fulfillment_mode: p.fulfillment_mode ?? "own_stock",
            stock_location: p.stock_location ?? "Almacén principal",
            condition_code: p.condition_code === "preowned" ? "used" : (p.condition_code ?? "new"),
            publication_status: (p.publication_status ?? "published") as PublicationStatus,
            sales_policy: (p.sales_policy ?? "own_stock") as SalesPolicy,
            supplier_source_status: (p.supplier_source_status ?? "not_applicable") as SupplierSourceStatus,
            supply_status: (p.supply_status ?? "not_applicable") as SupplyStatus,
            supplier_last_verified_at: p.supplier_last_verified_at ? p.supplier_last_verified_at.slice(0, 10) : "",
            availability_eta: p.availability_eta ? p.availability_eta.slice(0, 10) : "",
          };
          selectedSupplier = productSupplierSelection(p, supList);
        }
      }
    } catch (e: any) {
      showToast(e?.message || "Error al cargar datos", "err");
    } finally {
      loading = false;
    }
  }

  function chooseSupplier(val: string) {
    selectedSupplier = val;
    const snap = supplierSnapshotForSelection(val, suppliers, {
      supplier_name: form.supplier_name,
      supplier_contact: form.supplier_contact,
      supplier_email: form.supplier_email,
      supplier_phone: form.supplier_phone,
    });
    form.supplier_name = snap.supplier_name ?? "";
    form.supplier_contact = snap.supplier_contact ?? "";
    form.supplier_email = snap.supplier_email ?? "";
    form.supplier_phone = snap.supplier_phone ?? "";
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) {
      showToast("Indica el nombre del proveedor", "err");
      return;
    }
    savingSupplier = true;
    try {
      const created = await api.upsertSupplier({
        name: supplierForm.name.trim(),
        contact: supplierForm.contact.trim(),
        email: supplierForm.email.trim(),
        phone: supplierForm.phone.trim(),
        ordering_method: supplierForm.ordering_method,
        notes: supplierForm.notes.trim(),
        active: true,
      });
      suppliers = await api.listSuppliers();
      chooseSupplier(String(created.id));
      supplierModal = false;
      supplierForm = { name: "", contact: "", email: "", phone: "", ordering_method: "email", notes: "" };
      showToast("Proveedor creado y asignado");
    } catch (e: any) {
      showToast(e?.message || "Error al crear el proveedor", "err");
    } finally {
      savingSupplier = false;
    }
  }

  async function saveProduct() {
    const cost = parseEurosInput(form.cost);
    const price = parseEurosInput(form.price);
    if (cost === null || price === null) {
      showToast("Precio o coste no válidos", "err");
      return;
    }
    if (!form.sku.trim()) {
      showToast("El SKU es obligatorio", "err");
      return;
    }
    if (!form.name.trim()) {
      showToast("El nombre del producto es obligatorio", "err");
      return;
    }

    saving = true;
    const input: ProductInput = {
      id: product?.id,
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description,
      category: form.category.trim(),
      stock: Number(form.stock) || 0,
      min_stock: Number(form.min_stock) || 0,
      cost_cents: cost,
      price_cents: price,
      vat_rate: Number(form.vat_rate) as VatRate,
      supplier_name: form.supplier_name.trim(),
      supplier_contact: form.supplier_contact.trim(),
      supplier_email: form.supplier_email.trim(),
      supplier_phone: form.supplier_phone.trim(),
      fulfillment_mode: form.fulfillment_mode,
      stock_location: form.stock_location.trim(),
      condition_code: form.condition_code,
      publication_status: form.publication_status,
      sales_policy: form.sales_policy,
      supplier_source_status: form.supplier_source_status,
      supply_status: form.supply_status,
      supplier_last_verified_at: form.supplier_last_verified_at || null,
      availability_eta: form.availability_eta || null,
      active: true,
    };

    try {
      await api.upsertProduct(input);
      showToast(product ? "Producto actualizado correctamente" : "Producto creado correctamente");
      goto("/inventario");
    } catch (e: any) {
      showToast(e?.message || "Error al guardar el producto", "err");
    } finally {
      saving = false;
    }
  }

  function publicationBadge(status?: PublicationStatus, policy?: SalesPolicy) {
    if (status === "draft") return { label: "Borrador", tone: "neutral" as const };
    if (status === "archived") return { label: "Archivado", tone: "warn" as const };
    if (policy === "own_stock") return { label: "Publicado (Stock)", tone: "ok" as const };
    if (policy === "dropship") return { label: "Publicado (Dropship)", tone: "vat" as const };
    if (policy === "preorder") return { label: "Publicado (Preventa)", tone: "vat" as const };
    if (policy === "make_to_order") return { label: "Publicado (Bajo pedido)", tone: "vat" as const };
    return { label: "Publicado", tone: "ok" as const };
  }

  function supplyBadge(status?: SupplyStatus) {
    if (!status || status === "not_applicable") return null;
    if (status === "ordered") return { label: "Pedido confirmado", tone: "vat" as const };
    if (status === "in_transit") return { label: "En tránsito 🚚", tone: "warn" as const };
    if (status === "negotiating") return { label: "En negociación", tone: "neutral" as const };
    if (status === "received") return { label: "Recibido en almacén", tone: "ok" as const };
    if (status === "quality_hold") return { label: "Cuarentena QC", tone: "danger" as const };
    return null;
  }

  const pubInfo = $derived(publicationBadge(form.publication_status, form.sales_policy));
  const supInfo = $derived(supplyBadge(form.supply_status));
</script>

{#if loading}
  <div class="mx-auto flex max-w-6xl items-center justify-center p-12 text-[var(--color-muted)]">
    Cargando información del producto…
  </div>
{:else if notFound}
  <div class="mx-auto max-w-3xl p-6">
    <EmptyState
      title="Producto no encontrado"
      description="El producto que buscas no existe o ha sido eliminado."
    >
      <Button variant="primary" onclick={() => goto("/inventario")}>
        Volver al Inventario
      </Button>
    </EmptyState>
  </div>
{:else}
  <div class="mx-auto max-w-6xl px-4 py-6">
    <!-- Header Fijo de Página -->
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border-soft)] pb-4">
      <div class="flex items-center gap-3">
        <Button variant="ghost" onclick={() => goto("/inventario")}>
          ← Volver a Inventario
        </Button>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-[var(--color-text)] sm:text-2xl">
            {product ? `Editar producto: ${product.name}` : "Nuevo producto"}
          </h1>
          <p class="text-xs text-[var(--color-muted)]">
            Catálogo e invariantes de abastecimiento multiempresa
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <Badge tone={pubInfo.tone}>{pubInfo.label}</Badge>
        {#if supInfo}
          <Badge tone={supInfo.tone}>{supInfo.label}</Badge>
        {/if}
        <Button variant="ghost" onclick={() => goto("/inventario")}>Cancelar</Button>
        <Button variant="primary" disabled={saving} onclick={saveProduct}>
          {saving ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}
        </Button>
      </div>
    </div>

    <!-- Formulario de Producto -->
    <form
      class="flex flex-col gap-6"
      onsubmit={(e) => {
        e.preventDefault();
        saveProduct();
      }}
    >
      <!-- Card 1: Información general -->
      <Card class="p-6">
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-dim)]">
          Información general
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="SKU / Código" bind:value={form.sku} required placeholder="EJ: PRD-001" />
          <Input label="Nombre del producto" bind:value={form.name} required placeholder="Consola, juego, repuesto..." class="sm:col-span-2 lg:col-span-2" />
          <Select
            label="IVA"
            bind:value={form.vat_rate}
            options={VAT_RATES.map((r) => ({ value: String(r), label: vatLabel(r) }))}
          />
          <Input label="Categoría" bind:value={form.category} placeholder="Alimentación, Tecnología, Accesorios…" />
          <Input label="Descripción detallada" bind:value={form.description} placeholder="Detalles técnicos, especificaciones o notas" class="sm:col-span-2 lg:col-span-3" />
        </div>
      </Card>

      <!-- Card 2: Precios e Inventario -->
      <Card class="p-6">
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-dim)]">
          Precios e Inventario
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="PVP (€, IVA incl.)" bind:value={form.price} required placeholder="0.00" />
          <Input label="Coste (€)" bind:value={form.cost} required placeholder="0.00" />
          <Input label="Stock disponible" type="number" bind:value={form.stock} />
          <Input label="Stock mínimo (alerta reponer)" type="number" bind:value={form.min_stock} />
        </div>
      </Card>

      <!-- Card 3: Abastecimiento y Proveedor -->
      <Card class="p-6">
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-dim)]">
          Abastecimiento y Proveedor
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Cómo se sirve" bind:value={form.fulfillment_mode} options={fulfillmentOptions} />
          <Select label="Condición del artículo" bind:value={form.condition_code} options={conditionOptions} />
          <Input label="Ubicación / Origen" bind:value={form.stock_location} placeholder="Almacén principal, estantería A1…" />
          <div class="grid gap-2 sm:col-span-2 lg:col-span-3">
            <div class="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-end">
              <Select
                class="min-w-0 flex-1"
                label="Proveedor principal"
                value={selectedSupplier}
                options={supplierOptions}
                onvaluechange={chooseSupplier}
              />
              <Button type="button" variant="secondary" class="w-full shrink-0 sm:w-auto" onclick={() => (supplierModal = true)}>
                + Nuevo proveedor
              </Button>
            </div>
            {#if selectedSupplierRecord}
              <div class="rounded-xl border border-[var(--color-border-soft)] bg-white/[0.025] px-3.5 py-2.5 text-xs text-[var(--color-muted)]">
                <p class="font-semibold text-[var(--color-text)]">{selectedSupplierRecord.name}</p>
                <p class="mt-0.5">
                  {[selectedSupplierRecord.contact, selectedSupplierRecord.email, selectedSupplierRecord.phone].filter(Boolean).join(" · ") || "Sin datos de contacto guardados"}
                </p>
              </div>
            {:else if selectedSupplier === LEGACY_SUPPLIER}
              <p class="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-2.5 text-xs text-amber-100">
                Este artículo conserva un proveedor histórico que no está en el directorio. Puedes mantenerlo o elegir uno de la lista.
              </p>
            {:else if activeSuppliers.length === 0}
              <p class="text-xs text-[var(--color-muted-dim)]">Aún no hay proveedores guardados. Créalo desde el botón '+ Nuevo proveedor'.</p>
            {/if}
          </div>
        </div>
        {#if form.fulfillment_mode === "supplier_dropship"}
          <p class="mt-3 text-xs text-amber-200">ℹ️ Dropshipping: el proveedor envía directamente al cliente; no cuenta como existencias físicas en almacén local.</p>
        {/if}
      </Card>

      <!-- Card 4: Estado comercial y publicación -->
      <Card class="p-6">
        <h2 class="mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--color-muted-dim)]">
          Estado Comercial y Publicación
        </h2>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Select label="Estado de publicación" bind:value={form.publication_status} options={publicationStatusOptions} />
          <Select label="Política comercial" bind:value={form.sales_policy} options={salesPolicyOptions} />
          <Select label="Estado de abastecimiento" bind:value={form.supply_status} options={supplyStatusOptions} />
          {#if form.sales_policy === "dropship"}
            <Select label="Estado fuente proveedor" bind:value={form.supplier_source_status} options={supplierSourceStatusOptions} />
            <Input label="Última verificación proveedor" type="date" bind:value={form.supplier_last_verified_at} />
          {/if}
          {#if form.sales_policy === "preorder" || form.sales_policy === "make_to_order"}
            <Input label="ETA disponibilidad" type="date" bind:value={form.availability_eta} />
          {/if}
        </div>

        <!-- Invariant Alerts -->
        {#if form.publication_status === "published"}
          <div class="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3.5 text-xs text-rose-200">
            {#if form.sales_policy === "not_sellable"}
              <p>⚠️ No se puede publicar un producto con política 'No vendible'.</p>
            {:else if ["ordered", "in_transit", "negotiating", "quality_hold"].includes(form.supply_status)}
              <p>⚠️ No se puede publicar un producto en estado de abastecimiento '{form.supply_status === "ordered" ? "Pedido confirmado" : form.supply_status === "in_transit" ? "En tránsito" : form.supply_status === "negotiating" ? "En negociación" : "Cuarentena"}'.</p>
            {:else if form.sales_policy === "own_stock" && (Number(form.stock) || 0) <= 0}
              <p>⚠️ Publicar con stock propio requiere existencias > 0.</p>
            {:else if form.sales_policy === "dropship" && (form.supplier_source_status !== "approved" || !form.supplier_last_verified_at)}
              <p>⚠️ Dropshipping publicado requiere proveedor aprobado y verificado.</p>
            {:else if (form.sales_policy === "preorder" || form.sales_policy === "make_to_order") && !form.availability_eta}
              <p>⚠️ Preventa/bajo pedido publicado requiere fecha ETA.</p>
            {/if}
          </div>
        {/if}
      </Card>

      <!-- Bottom Action Bar -->
      <div class="flex items-center justify-end gap-3 border-t border-[var(--color-border-soft)] pt-4">
        <Button variant="ghost" onclick={() => goto("/inventario")}>Cancelar</Button>
        <Button variant="primary" disabled={saving} onclick={saveProduct}>
          {saving ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}
        </Button>
      </div>
    </form>
  </div>
{/if}

<!-- Modal Pequeño para Crear Proveedor desde la Ficha -->
<Modal open={supplierModal} title="Nuevo proveedor" size="md" onclose={() => (supplierModal = false)}>
  <form class="grid gap-3.5" onsubmit={(e) => { e.preventDefault(); saveSupplier(); }}>
    <Input label="Proveedor / Empresa" bind:value={supplierForm.name} required placeholder="Nombre de la empresa o proveedor" />
    <div class="grid gap-3 sm:grid-cols-2">
      <Input label="Contacto directo" bind:value={supplierForm.contact} placeholder="Persona de contacto" />
      <Input label="Teléfono" bind:value={supplierForm.phone} placeholder="+34 600..." />
    </div>
    <Input label="Email de pedidos" type="email" bind:value={supplierForm.email} placeholder="pedidos@proveedor.com" />
    <Input label="Notas internas" bind:value={supplierForm.notes} placeholder="Condiciones, descuentos, MOQ..." />
    <div class="mt-3 flex justify-end gap-2.5">
      <Button variant="ghost" type="button" onclick={() => (supplierModal = false)}>Cancelar</Button>
      <Button type="submit" disabled={savingSupplier}>
        {savingSupplier ? "Guardando…" : "Crear proveedor"}
      </Button>
    </div>
  </form>
</Modal>
