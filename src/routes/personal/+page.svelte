<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "$lib/api/client";
  import type { AuthUser, Employee, EmployeeInput, Payroll, PayrollInput } from "$lib/types";
  import { isAdmin } from "$lib/stores/session";
  import { showToast } from "$lib/stores/ui";
  import { formatEUR, parseEurosInput } from "$lib/money";
  import { payrollTotals } from "$lib/payroll";
  import Card from "$lib/components/Card.svelte";
  import Button from "$lib/components/Button.svelte";
  import Input from "$lib/components/Input.svelte";
  import Select from "$lib/components/Select.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Badge from "$lib/components/Badge.svelte";
  import DateRangePicker from "$lib/components/DateRangePicker.svelte";

  let employees = $state<Employee[]>([]);
  let payrolls = $state<Payroll[]>([]);
  let users = $state<AuthUser[]>([]);
  let loading = $state(true);
  let employeeOpen = $state(false);
  let payrollOpen = $state(false);
  let saving = $state(false);
  let selectedEmployeeId = $state<number | null>(null);
  let employeeForm = $state(blankEmployee());
  let payrollForm = $state(blankPayroll());

  const selectedEmployee = $derived(employees.find((employee) => employee.id === selectedEmployeeId) ?? null);
  const selectedPayrolls = $derived(payrolls.filter((payroll) => payroll.employee_id === selectedEmployeeId));
  const activeCount = $derived(employees.filter((employee) => employee.status === "active").length);
  const pendingPayrolls = $derived(payrolls.filter((payroll) => payroll.status !== "paid" && payroll.status !== "cancelled").length);

  function blankEmployee(): EmployeeInput {
    return { first_name: "", last_name: "", user_id: null, tax_id: "", social_security_number: "", email: "", phone: "", position: "", contract_type: "", work_schedule: "", collective_agreement: "", professional_group: "", start_date: null, end_date: null, annual_gross_cents: 0, payments_per_year: 12, iban: "", status: "active", notes: "", documents: [] };
  }

  function blankPayroll(): PayrollInput {
    return { employee_id: selectedEmployeeId ?? 0, period: new Date().toISOString().slice(0, 7), gross_cents: 0, employee_ss_cents: 0, irpf_cents: 0, other_deductions_cents: 0, net_cents: 0, employer_ss_cents: 0, total_cost_cents: 0, status: "draft", document_name: "", document_url: "", notes: "" };
  }

  async function load() {
    if (!$isAdmin) { loading = false; return; }
    loading = true;
    try {
      [employees, payrolls, users] = await Promise.all([api.listEmployees(), api.listPayrolls(), api.listUsers()]);
      if (selectedEmployeeId == null && employees.length) selectedEmployeeId = employees[0].id;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "No se pudo cargar Personal", "err");
    } finally { loading = false; }
  }

  function editEmployee(employee?: Employee) {
    employeeForm = employee ? { ...employee, documents: [...employee.documents] } : blankEmployee();
    employeeOpen = true;
  }

  function editPayroll(payroll?: Payroll) {
    if (!selectedEmployeeId) return;
    payrollForm = payroll ? { ...payroll } : blankPayroll();
    payrollOpen = true;
  }

  async function saveEmployee() {
    saving = true;
    try {
      const saved = await api.upsertEmployee(employeeForm);
      employeeOpen = false;
      selectedEmployeeId = saved.id;
      showToast(employeeForm.id ? "Empleado actualizado" : "Empleado dado de alta");
      await load();
    } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo guardar", "err"); }
    finally { saving = false; }
  }

  function cents(value: string) { return parseEurosInput(value) ?? 0; }
  function euros(value: number | undefined) { return value ? String(value / 100).replace(".", ",") : ""; }

  async function savePayroll() {
    saving = true;
    try {
      const totals = payrollTotals({
        gross_cents: Number(payrollForm.gross_cents ?? 0), employee_ss_cents: Number(payrollForm.employee_ss_cents ?? 0),
        irpf_cents: Number(payrollForm.irpf_cents ?? 0), other_deductions_cents: Number(payrollForm.other_deductions_cents ?? 0),
        employer_ss_cents: Number(payrollForm.employer_ss_cents ?? 0),
      });
      await api.upsertPayroll({ ...payrollForm, ...totals, employee_id: selectedEmployeeId! });
      payrollOpen = false;
      showToast(payrollForm.id ? "Nómina actualizada" : "Nómina registrada");
      await load();
    } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo guardar", "err"); }
    finally { saving = false; }
  }

  async function pay(payroll: Payroll) {
    if (!confirm(`¿Registrar el pago de ${formatEUR(payroll.net_cents)} en Caja?`)) return;
    try {
      const employee = employees.find((item) => item.id === payroll.employee_id);
      const movement = await api.createCashMovement({ kind: "expense", amount_cents: payroll.net_cents, category: "nominas", description: `Nómina ${payroll.period} · ${employee?.first_name ?? ""} ${employee?.last_name ?? ""}`.trim() });
      await api.upsertPayroll({ ...payroll, status: "paid", paid_at: new Date().toISOString(), cash_movement_id: movement.id });
      showToast("Nómina pagada y salida registrada en Caja");
      await load();
    } catch (error) { showToast(error instanceof Error ? error.message : "No se pudo registrar el pago", "err"); }
  }

  function maskIban(iban: string) { return iban.length > 4 ? `•••• ${iban.slice(-4)}` : iban || "—"; }
  onMount(load);
</script>

{#if !$isAdmin}
  <Card lift={false} class="mx-auto max-w-xl text-center">
    <h2 class="text-xl font-semibold">Acceso restringido</h2>
    <p class="mt-2 text-[var(--color-muted)]">Los datos laborales y las nóminas solo están disponibles para administradores.</p>
  </Card>
{:else if loading}
  <p class="py-16 text-center text-[var(--color-muted)]">Cargando personal…</p>
{:else}
  <div class="space-y-5">
    <div class="grid gap-3 sm:grid-cols-3">
      <Card lift={false}><p class="text-sm text-[var(--color-muted)]">Empleados activos</p><p class="mt-1 text-3xl font-semibold">{activeCount}</p></Card>
      <Card lift={false}><p class="text-sm text-[var(--color-muted)]">Nóminas pendientes</p><p class="mt-1 text-3xl font-semibold">{pendingPayrolls}</p></Card>
      <Card lift={false}><p class="text-sm text-[var(--color-muted)]">Coste anual informado</p><p class="mt-1 text-2xl font-semibold">{formatEUR(employees.reduce((sum, e) => sum + e.annual_gross_cents, 0))}</p></Card>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
      <div><h2 class="text-xl font-semibold">Equipo</h2><p class="text-sm text-[var(--color-muted)]">El empleado puede vincularse a un usuario del CRM, pero son registros distintos.</p></div>
      <Button onclick={() => editEmployee()}>+ Alta de empleado</Button>
    </div>

    <div class="grid gap-5 xl:grid-cols-[minmax(17rem,0.34fr)_minmax(0,1fr)]">
      <div class="space-y-2">
        {#each employees as employee}
          <button class="glass w-full rounded-xl border p-4 text-left transition {selectedEmployeeId === employee.id ? 'border-purple-400/50 bg-purple-500/10' : 'border-[var(--color-border-soft)] hover:border-purple-400/25'}" onclick={() => selectedEmployeeId = employee.id}>
            <div class="flex items-start justify-between gap-2"><strong>{employee.first_name} {employee.last_name}</strong><Badge tone={employee.status === "active" ? "ok" : employee.status === "leave" ? "warn" : "neutral"}>{employee.status === "active" ? "Activo" : employee.status === "leave" ? "Baja" : "Finalizado"}</Badge></div>
            <p class="mt-1 text-sm text-[var(--color-muted)]">{employee.position || "Puesto sin indicar"}</p>
            <p class="mt-2 text-xs text-[var(--color-muted-dim)]">IBAN {maskIban(employee.iban)}</p>
          </button>
        {:else}
          <Card lift={false} class="text-center"><p class="text-[var(--color-muted)]">Todavía no hay empleados.</p></Card>
        {/each}
      </div>

      {#if selectedEmployee}
        <div class="space-y-4">
          <Card lift={false}>
            <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="text-xl font-semibold">{selectedEmployee.first_name} {selectedEmployee.last_name}</h3><p class="text-sm text-[var(--color-muted)]">{selectedEmployee.position || "Sin puesto"} · {selectedEmployee.contract_type || "Contrato sin indicar"}</p></div><Button variant="secondary" onclick={() => editEmployee(selectedEmployee)}>Editar ficha</Button></div>
            <div class="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><span class="text-[var(--color-muted)]">Inicio</span><p>{selectedEmployee.start_date || "—"}</p></div><div><span class="text-[var(--color-muted)]">Bruto anual</span><p>{formatEUR(selectedEmployee.annual_gross_cents)}</p></div><div><span class="text-[var(--color-muted)]">Pagas</span><p>{selectedEmployee.payments_per_year}</p></div><div><span class="text-[var(--color-muted)]">Usuario CRM</span><p>{users.find((u) => u.id === selectedEmployee.user_id)?.display_name || "No vinculado"}</p></div></div>
          </Card>
          <div class="flex items-center justify-between gap-3"><div><h3 class="text-lg font-semibold">Nóminas</h3><p class="text-xs text-amber-300/80">Registro documental: verifica siempre los importes con tu asesoría laboral.</p></div><Button onclick={() => editPayroll()}>+ Añadir nómina</Button></div>
          <Card lift={false} class="overflow-x-auto p-0">
            <table class="w-full min-w-[720px] text-sm"><thead><tr class="border-b border-[var(--color-border-soft)] text-left text-[var(--color-muted)]"><th class="p-4">Periodo</th><th class="p-4">Bruto</th><th class="p-4">Neto</th><th class="p-4">Coste empresa</th><th class="p-4">Estado</th><th class="p-4 text-right">Acciones</th></tr></thead><tbody>
              {#each selectedPayrolls as payroll}
                <tr class="border-b border-[var(--color-border-soft)] last:border-0"><td class="p-4 font-medium">{payroll.period}</td><td class="p-4">{formatEUR(payroll.gross_cents)}</td><td class="p-4">{formatEUR(payroll.net_cents)}</td><td class="p-4">{formatEUR(payroll.total_cost_cents)}</td><td class="p-4"><Badge tone={payroll.status === "paid" ? "ok" : payroll.status === "reviewed" ? "info" : payroll.status === "cancelled" ? "danger" : "warn"}>{payroll.status === "paid" ? "Pagada" : payroll.status === "reviewed" ? "Revisada" : payroll.status === "cancelled" ? "Anulada" : "Borrador"}</Badge></td><td class="p-4"><div class="flex justify-end gap-2"><Button variant="ghost" onclick={() => editPayroll(payroll)}>Editar</Button>{#if payroll.document_url}<a class="rounded-full px-3 py-2 text-purple-300 hover:bg-purple-500/10" href={payroll.document_url} target="_blank" rel="noreferrer">Documento</a>{/if}{#if payroll.status !== "paid" && payroll.status !== "cancelled"}<Button variant="secondary" onclick={() => pay(payroll)}>Pagar</Button>{/if}</div></td></tr>
              {:else}<tr><td colspan="6" class="p-10 text-center text-[var(--color-muted)]">No hay nóminas registradas para este empleado.</td></tr>{/each}
            </tbody></table>
          </Card>
        </div>
      {/if}
    </div>
  </div>
{/if}

<Modal open={employeeOpen} title={employeeForm.id ? "Editar empleado" : "Alta de empleado"} size="xl" onclose={() => employeeOpen = false}>
  <div class="space-y-5">
    <div class="grid gap-4 sm:grid-cols-2"><Input label="Nombre" bind:value={employeeForm.first_name} required /><Input label="Apellidos" bind:value={employeeForm.last_name} required /><Input label="NIF/NIE" bind:value={employeeForm.tax_id} /><Input label="N.º Seguridad Social" bind:value={employeeForm.social_security_number} /><Input label="Correo" type="email" bind:value={employeeForm.email} /><Input label="Teléfono" bind:value={employeeForm.phone} /></div>
    <div class="grid gap-4 sm:grid-cols-2"><Input label="Puesto" bind:value={employeeForm.position} /><Input label="Tipo de contrato" bind:value={employeeForm.contract_type} /><Input label="Jornada" bind:value={employeeForm.work_schedule} /><Input label="Convenio colectivo" bind:value={employeeForm.collective_agreement} /><Input label="Grupo profesional" bind:value={employeeForm.professional_group} /><Select label="Usuario del CRM (opcional)" value={employeeForm.user_id == null ? '' : String(employeeForm.user_id)} onvaluechange={(v) => employeeForm.user_id = v ? Number(v) : null} options={[{value: '', label: 'Sin vincular'}, ...users.map(u => ({value: String(u.id), label: u.display_name}))]} /></div>
    <div class="grid gap-4 sm:grid-cols-2"><DateRangePicker label="Periodo del contrato" bind:start={employeeForm.start_date} bind:end={employeeForm.end_date} /><div class="grid gap-4 sm:grid-cols-2"><Input label="Bruto anual (€)" value={euros(employeeForm.annual_gross_cents)} oninput={(e) => employeeForm.annual_gross_cents = cents(e.currentTarget.value)} /><Select label="Pagas al año" value={String(employeeForm.payments_per_year ?? 12)} onvaluechange={(v) => employeeForm.payments_per_year = Number(v)} options={[{value:'12',label:'12 pagas'},{value:'14',label:'14 pagas'}]} /></div></div>
    <div class="grid gap-4 sm:grid-cols-2"><Input label="IBAN" bind:value={employeeForm.iban} /><Select label="Estado" bind:value={employeeForm.status} options={[{value:'active',label:'Activo'},{value:'leave',label:'Baja'},{value:'ended',label:'Finalizado'}]} /></div>
    <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium text-[var(--color-muted)]">Notas internas</span><textarea class="field min-h-24" bind:value={employeeForm.notes}></textarea></label>
    <div class="flex justify-end gap-3"><Button variant="secondary" onclick={() => employeeOpen = false}>Cancelar</Button><Button disabled={saving} onclick={saveEmployee}>{saving ? "Guardando…" : "Guardar empleado"}</Button></div>
  </div>
</Modal>

<Modal open={payrollOpen} title={payrollForm.id ? "Editar nómina" : "Registrar nómina"} size="lg" onclose={() => payrollOpen = false}>
  <div class="space-y-5">
    <p class="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200">Introduce los importes de la nómina preparada por tu asesoría. El CRM solo calcula el neto aritmético y el coste total para facilitar el registro.</p>
    <div class="grid gap-4 sm:grid-cols-2"><Input label="Periodo" type="month" bind:value={payrollForm.period} required /><Select label="Estado" bind:value={payrollForm.status} options={[{value:'draft',label:'Borrador'},{value:'reviewed',label:'Revisada'},{value:'paid',label:'Pagada'},{value:'cancelled',label:'Anulada'}]} /></div>
    <div class="grid gap-4 sm:grid-cols-2"><Input label="Bruto (€)" value={euros(payrollForm.gross_cents)} oninput={(e) => payrollForm.gross_cents = cents(e.currentTarget.value)} /><Input label="Seg. Social trabajador (€)" value={euros(payrollForm.employee_ss_cents)} oninput={(e) => payrollForm.employee_ss_cents = cents(e.currentTarget.value)} /><Input label="Retención IRPF (€)" value={euros(payrollForm.irpf_cents)} oninput={(e) => payrollForm.irpf_cents = cents(e.currentTarget.value)} /><Input label="Otras deducciones (€)" value={euros(payrollForm.other_deductions_cents)} oninput={(e) => payrollForm.other_deductions_cents = cents(e.currentTarget.value)} /><Input label="Seg. Social empresa (€)" value={euros(payrollForm.employer_ss_cents)} oninput={(e) => payrollForm.employer_ss_cents = cents(e.currentTarget.value)} /></div>
    <div class="grid gap-4 sm:grid-cols-2"><Input label="Nombre del documento" bind:value={payrollForm.document_name} placeholder="nomina-2026-08.pdf" /><Input label="Enlace al documento" type="url" bind:value={payrollForm.document_url} placeholder="https://…" /></div>
    <label class="flex flex-col gap-1.5 text-sm"><span class="font-medium text-[var(--color-muted)]">Notas</span><textarea class="field min-h-20" bind:value={payrollForm.notes}></textarea></label>
    <div class="flex justify-end gap-3"><Button variant="secondary" onclick={() => payrollOpen = false}>Cancelar</Button><Button disabled={saving} onclick={savePayroll}>{saving ? "Guardando…" : "Guardar nómina"}</Button></div>
  </div>
</Modal>
