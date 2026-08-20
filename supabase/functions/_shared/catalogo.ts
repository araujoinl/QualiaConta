// _shared/catalogo.ts — los GUIDs de ADM por empresa, desde tabla (F4 prec. 8).
//
// Mata la brecha 1 del plan madre: hoy TaxScheduleID, ExpenseTypeID, TERMINOS,
// UUIDS_CONOCIDOS y las tarjetas-caja viven hardcodeados en seis archivos y
// atan todo a Blackbox. Acá se cargan UNA vez por invocación desde
// `qualia_catalogo_adm` + el plan de cuentas vivo de /api/Accounts.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import type { AdmCliente } from './adm.ts';

export interface TaxSchedule {
  id: string;
  pct: number;
}

export class Catalogo {
  #cuentas = new Map<string, string>(); // codigo -> UUID (plan vivo + extras)
  #tax = new Map<string, TaxSchedule>(); // '18' -> {id, pct}
  #expense = new Map<string, { id: string; nombre: string }>(); // '01'..'11'
  #terminos = new Map<string, string>(); // 'al contado' | '30' | '45' | '60'
  #cajaTarjetas = new Set<string>(); // 203.10, 203.11…
  #bancoRnc = new Map<string, string>(); // 'santacruz' -> '102012921' (vive en `nombre`)
  #tipoGastoDefecto: string | null = null;
  #grupos = new Set<string>(); // UUIDs de cuentas agrupadoras (ADM no las afecta)
  #nombreCuenta = new Map<string, string>(); // uuid -> Name (para mensajes)
  // numero de cuenta del banco -> {codigo contable, moneda}; y tarjeta -> codigo.
  // ADM tiene cuentas separadas por moneda: pagar cruzando monedas no es un
  // pago, es una conversión — la decide un humano.
  #cuentasBanco = new Map<string, { codigo: string; moneda: string }>();
  #tarjetasNumero = new Map<string, string>();

  private constructor() {}

  /**
   * Carga catálogo + plan de cuentas. El plan viene del ADM VIVO en cada
   * invocación (una cuenta nueva aparece sola); los GUIDs de catálogos DGII
   * vienen de la tabla (cambian una vez por empresa, jamás por documento).
   * En /api/Accounts el campo del código es `Code`; `AccountCode` viene null
   * (lección de mapa_cuentas() del fuente).
   */
  static async cargar(sb: SupabaseClient, adm: AdmCliente, empresaId: string): Promise<Catalogo> {
    const c = new Catalogo();

    const { data, error } = await sb
      .from('qualia_catalogo_adm')
      .select('categoria, clave, valor_uuid, nombre')
      .eq('empresa_id', empresaId);
    if (error) throw new Error(`qualia_catalogo_adm ilegible: ${error.message}`);
    for (const f of data ?? []) {
      const clave = String(f.clave);
      switch (f.categoria) {
        case 'tax_schedule':
          if (f.valor_uuid) c.#tax.set(clave, { id: f.valor_uuid, pct: Number(clave) });
          break;
        case 'expense_type':
          if (f.valor_uuid) c.#expense.set(clave, { id: f.valor_uuid, nombre: f.nombre ?? '' });
          break;
        case 'termino_pago':
          if (f.valor_uuid) c.#terminos.set(clave, f.valor_uuid);
          break;
        case 'cuenta_uuid':
          if (f.valor_uuid) c.#cuentas.set(clave, f.valor_uuid);
          break;
        case 'cuenta_caja_tarjeta':
          c.#cajaTarjetas.add(clave);
          break;
        case 'banco_rnc':
          // El RNC no es un uuid: viaja en `nombre` (solo dígitos).
          if (f.nombre) c.#bancoRnc.set(clave.toLowerCase(), String(f.nombre).replace(/\D/g, ''));
          break;
        case 'cuenta_banco': {
          // clave = número de cuenta; nombre = 'codigo|MONEDA' ('101.06|DOP')
          const [codigo, moneda] = String(f.nombre ?? '').split('|');
          if (codigo && moneda) c.#cuentasBanco.set(clave, { codigo: codigo.trim(), moneda: moneda.trim() });
          break;
        }
        case 'tarjeta_numero':
          if (f.nombre) c.#tarjetasNumero.set(clave, String(f.nombre).trim());
          break;
        case 'config':
          if (clave === 'tipo_gasto_defecto' && f.valor_uuid) c.#tipoGastoDefecto = f.valor_uuid;
          break;
      }
    }
    if (!c.#tax.size || !c.#expense.size || !c.#terminos.size) {
      throw new Error(
        `catálogo incompleto para la empresa (tax:${c.#tax.size} expense:${c.#expense.size} ` +
          `terminos:${c.#terminos.size}): sembrar qualia_catalogo_adm antes de registrar`,
      );
    }

    for (const cta of await adm.paginar('Accounts')) {
      const cod = String(cta?.Code ?? cta?.AccountCode ?? '').trim();
      if (cod && cta?.ID && !c.#cuentas.has(cod)) c.#cuentas.set(cod, cta.ID);
      if (cta?.ID) {
        c.#nombreCuenta.set(String(cta.ID), String(cta?.Name ?? ''));
        // ADM no afecta cuentas de GRUPO: hay que usar la subcuenta hoja.
        if (cta?.GroupAccount === true) c.#grupos.add(String(cta.ID));
      }
    }
    return c;
  }

  esGrupo(uuid: string): boolean {
    return this.#grupos.has(String(uuid));
  }

  nombreCuenta(uuid: string): string {
    return this.#nombreCuenta.get(String(uuid)) ?? '';
  }

  /** {codigo, moneda} de una cuenta de banco por su NÚMERO ('11122010023874'). */
  cuentaBancoPorNumero(numero: string): { codigo: string; moneda: string } | null {
    return this.#cuentasBanco.get(String(numero ?? '').trim()) ?? null;
  }

  /** Código contable de una tarjeta por su número enmascarado. */
  tarjetaPorNumero(numero: string): string | null {
    return this.#tarjetasNumero.get(String(numero ?? '').trim()) ?? null;
  }

  cuentaUuid(codigo: string): string | null {
    return this.#cuentas.get(String(codigo).trim()) ?? null;
  }

  /**
   * Schedule por tasa efectiva, el MÁS CERCANO dentro de 1 punto — con tasa
   * 17.0 el 16 y el 18 están ambos a un punto y el orden del dict decidía en
   * silencio cuál se le cobraba al documento (lección del fuente).
   */
  taxPorTasa(tasa: number): TaxSchedule | null {
    let mejor: TaxSchedule | null = null;
    let mejorDist = 1.0 + 1e-9;
    for (const t of this.#tax.values()) {
      const d = Math.abs(tasa - t.pct);
      if (d <= 1.0 && d < mejorDist) {
        mejor = t;
        mejorDist = d;
      }
    }
    return mejor;
  }

  /** Las tasas de ITBIS que la empresa conoce (16, 18, 30…), para mensajes y lecturas. */
  get tasasLegales(): number[] {
    return [...this.#tax.values()].map((t) => t.pct).sort((a, b) => a - b);
  }

  expenseType(codigo: string): { id: string; nombre: string } | null {
    return this.#expense.get(String(codigo).trim().padStart(2, '0')) ?? null;
  }

  get tipoGastoDefecto(): string {
    if (!this.#tipoGastoDefecto) throw new Error('catálogo sin tipo_gasto_defecto');
    return this.#tipoGastoDefecto;
  }

  terminoPago(clave: string): string | null {
    return this.#terminos.get(clave) ?? null;
  }

  get terminoContado(): string {
    const t = this.#terminos.get('al contado');
    if (!t) throw new Error('catálogo sin término «al contado»');
    return t;
  }

  /** RNC del banco emisor de comprobantes, por código de banco ('santacruz'). */
  bancoRnc(banco: string): string | null {
    return this.#bancoRnc.get(String(banco ?? '').trim().toLowerCase()) ?? null;
  }

  /** Cuentas de caja: 101.xx, 102.xx y las tarjetas ENUMERADAS (jamás 203. entero). */
  esCuentaCaja(codigo: string): boolean {
    const cod = String(codigo ?? '').trim();
    return cod.startsWith('101.') || cod.startsWith('102.') || this.#cajaTarjetas.has(cod);
  }
}
