// qualia-preparador/dgii.ts — las tres consultas a DGII del fuente, con sus
// endpoints y su parseo exactos:
//
//   1. NCF impreso  → dgii.gov.do/.../consultas/ncf.aspx  (port de
//      consultar-ncf-dgii.py: ASP.NET WebForms, __VIEWSTATE + cookies, sin
//      captcha verificado 2026-08-02; sin User-Agent de browser responde 403)
//   2. Timbre e-CF  → ecf.dgii.gov.do/ecf/ConsultaTimbre(FC)  (bloque 6 del
//      preparar-trabajo.sh: FechaFirma viaja con %20, no '+')
//   3. Padrón RNC   → dgii.gov.do/.../consultas/rnc.aspx  (port de
//      consultar-rnc-dgii.py: el botón BUSCAR dispara __doPostBack)
//
// Regla pareja de los tres: siempre devuelven "estado"; nunca inventan un
// resultado — si algo falla, estado = "no verificable" con su motivo.

import { conPlazo } from './comun.ts';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PREFIJO = 'ctl00$cphMain$';
const URL_NCF = 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/ncf.aspx';
const URL_RNC = 'https://dgii.gov.do/app/WebApps/ConsultasWeb2/ConsultasWeb/consultas/rnc.aspx';

export type FichaDgii = Record<string, unknown>;

function decodEntidades(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
}

// El mismo aplanado de HTML de los dos scripts y del bloque 6 del fuente.
function textoPlano(html: string): string {
  let h = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<br\s*\/?>|<\/tr>|<\/p>|<\/div>/gi, '\n');
  h = h.replace(/<\/t[dh]>/gi, ' | ');
  h = h.replace(/<[^>]+>/g, ' ');
  h = decodEntidades(h);
  return h.replace(/[ \t]{2,}/g, ' ');
}

/** __VIEWSTATE y compañía: sin ellos ASP.NET descarta el POST. */
function ocultos(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const campo of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    const m = html.match(new RegExp(`name="${campo}"[^>]*value="([^"]*)"`));
    if (m) out[campo] = decodEntidades(m[1]);
  }
  return out;
}

/**
 * Etiquetas de la ficha → clave del JSON. El (?:...) alrededor del patrón es
 * obligatorio: varias etiquetas traen alternancia y sin agrupar, el `|` parte
 * el patrón entero — reventaba justo en las fichas VIGENTES (bug pagado en
 * consultar-ncf-dgii.py).
 */
function parsearFicha(
  texto: string,
  campos: Array<[string, string]>,
  maxLen: number,
): Record<string, string> {
  const datos: Record<string, string> = {};
  for (const [patron, clave] of campos) {
    const m = texto.match(new RegExp(`(?:${patron})\\s*[:|]\\s*([^\\n|]{1,${maxLen}})`, 'i'));
    if (m) {
      const v = m[1].replace(/\s+/g, ' ').trim().replace(/^[ .|]+/, '').replace(/[ .|]+$/, '');
      if (v && !/^[-–—]*$/.test(v) && !(clave in datos)) datos[clave] = v;
    }
  }
  return datos;
}

function cookieDe(r: Response): string {
  const h = r.headers as Headers & { getSetCookie?: () => string[] };
  const lista = typeof h.getSetCookie === 'function'
    ? h.getSetCookie()
    : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie') as string] : []);
  return lista.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

const CABECERAS_GET = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'es-DO,es;q=0.9',
};

// ───────────────────────── 1. NCF impreso ───────────────────────────────────

const CAMPOS_NCF: Array<[string, string]> = [
  ['RNC\\s*(?:\\/\\s*C[eé]dula)?\\s*(?:Emisor)?', 'rnc_emisor'],
  ['Raz[oó]n\\s+Social\\s*(?:Emisor)?', 'razon_social_emisor'],
  ['RNC\\s*Comprador', 'rnc_comprador'],
  ['Raz[oó]n\\s+Social\\s*Comprador', 'razon_social_comprador'],
  ['(?:e-)?NCF', 'ncf'],
  ['Estado', 'estado'],
  ['Tipo\\s+de\\s+Comprobante', 'tipo_comprobante'],
  ['Fecha\\s+de\\s+(?:Emisi[oó]n|Vencimiento)', 'fecha'],
  ['Vigencia|V[aá]lido\\s+hasta', 'vigencia'],
];

export async function consultaNcfImpreso(rnc: string, ncf: string): Promise<FichaDgii> {
  const salida: FichaDgii = {
    tipo: ncf.startsWith('E') ? 'ecf' : 'ncf_impreso',
    ncf,
    rnc_emisor: rnc,
    fuente: 'dgii.gov.do/consultas/ncf',
  };
  try {
    const r1 = await fetch(URL_NCF, { headers: CABECERAS_GET, signal: AbortSignal.timeout(25_000) });
    if (!r1.ok) {
      salida.estado = 'no verificable';
      salida.motivo = `DGII respondio HTTP ${r1.status}`;
      return salida;
    }
    const html = await r1.text();
    const campos: Record<string, string> = ocultos(html);
    if (!('__VIEWSTATE' in campos)) {
      throw new Error('la pagina no trajo __VIEWSTATE (cambio de forma?)');
    }
    campos[PREFIJO + 'txtRNC'] = rnc;
    campos[PREFIJO + 'txtNCF'] = ncf;
    campos[PREFIJO + 'txtRncComprador'] = '';
    campos[PREFIJO + 'txtCodigoSeg'] = '';
    campos[PREFIJO + 'btnConsultar'] = 'Consultar';
    const r2 = await fetch(URL_NCF, {
      method: 'POST',
      headers: {
        ...CABECERAS_GET,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': URL_NCF,
        'Cookie': cookieDe(r1),
      },
      body: new URLSearchParams(campos).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r2.ok) {
      salida.estado = 'no verificable';
      salida.motivo = `DGII respondio HTTP ${r2.status}`;
      return salida;
    }
    const texto = textoPlano(await r2.text());
    Object.assign(salida, parsearFicha(texto, CAMPOS_NCF, 80));
    if (!('estado' in salida)) {
      // DGII responde el "no existe" como mensaje suelto, no como ficha.
      if (/no\s+(?:se\s+encontr|existe|corresponde|es\s+v[aá]lido)/i.test(texto)) {
        salida.estado = 'NO VALIDO';
        const m = texto.match(
          /([^\n]{0,120}no\s+(?:se\s+encontr|existe|corresponde|es\s+v[aá]lido)[^\n]{0,80})/i,
        );
        if (m) salida.mensaje = m[1].replace(/\s+/g, ' ').trim().slice(0, 160);
      } else {
        salida.estado = 'no verificable';
        salida.motivo = 'la respuesta de DGII no trajo ni ficha ni mensaje reconocible';
      }
    }
  } catch (e) {
    salida.estado = 'no verificable';
    salida.motivo = `${e instanceof Error ? e.name : 'error'}: ${
      String(e instanceof Error ? e.message : e).slice(0, 100)
    }`;
  }
  return salida;
}

// ───────────────────────── 2. Timbre e-CF ───────────────────────────────────

const CAMPOS_TIMBRE: Array<[string, string]> = [
  ['Estado', 'estado'],
  ['RNC\\s*Emisor', 'rnc_emisor'],
  ['Raz[oó]n\\s+Social\\s+(?:del\\s+)?Emisor', 'razon_social_emisor'],
  ['RNC\\s*Comprador', 'rnc_comprador'],
  ['Raz[oó]n\\s+Social\\s+(?:del\\s+)?Comprador', 'razon_social_comprador'],
  ['Total\\s*(?:de\\s*)?ITBIS', 'total_itbis'],
  ['Monto\\s*Total', 'monto_total'],
  ['Fecha\\s*(?:de\\s*)?Emisi[oó]n', 'fecha_emision'],
];

export interface ParamsTimbre {
  rncEmisor: string;
  rncComprador: string;
  encf: string;
  fechaEmisionIso: string; // YYYY-MM-DD, se voltea a DD-MM-AAAA al armar la URL
  monto: string; // ya con 2 decimales
  fechaFirma: string; // DD-MM-YYYY HH:MM:SS
  codigo: string;
}

export async function consultaTimbreEcf(p: ParamsTimbre): Promise<FichaDgii> {
  const tipo = p.encf.slice(1, 3);
  const ruta = tipo === '32' ? 'ConsultaTimbreFC' : 'ConsultaTimbre';
  const salida: FichaDgii = { tipo: 'ecf', encf: p.encf, fuente: `ecf.dgii.gov.do/ecf/${ruta}` };
  try {
    const [a, m, d] = p.fechaEmisionIso.split('-');
    // encodeURIComponent y no URLSearchParams: el espacio de FechaFirma viaja
    // como %20, no '+' — es el formato del QR real (bloque 6 del fuente).
    const qs = Object.entries({
      RncEmisor: p.rncEmisor,
      RncComprador: p.rncComprador,
      ENCF: p.encf,
      FechaEmision: `${d}-${m}-${a}`,
      MontoTotal: p.monto,
      FechaFirma: p.fechaFirma,
      CodigoSeguridad: p.codigo,
    })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const r = await fetch(`https://ecf.dgii.gov.do/ecf/${ruta}?${qs}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'es-DO,es;q=0.9' },
      signal: AbortSignal.timeout(30_000),
    });
    const texto = textoPlano(await r.text());
    for (const [clave, valor] of Object.entries(parsearFicha(texto, CAMPOS_TIMBRE, 80))) {
      if (!(clave in salida)) salida[clave] = valor;
    }
    for (const clave of ['total_itbis', 'monto_total']) {
      if (clave in salida) {
        const crudo = String(salida[clave]).replace(/RD\$/g, '').replace(/\$/g, '').replace(/,/g, '').trim();
        const n = parseFloat(crudo);
        if (Number.isFinite(n)) salida[clave] = n;
      }
    }
    if (!('estado' in salida)) {
      // La tabla no trajo la etiqueta "Estado": barrido por palabra clave
      // (el orden importa: "Aceptado Condicional" antes que "Aceptado").
      const barrido: Array<[RegExp, string]> = [
        [/Aceptado\s+Condicional/i, 'Aceptado Condicional'],
        [/\bAceptado\b/i, 'Aceptado'],
        [/\bRechazado\b/i, 'Rechazado'],
        [/\bEn\s+Proceso\b/i, 'En Proceso'],
        [/no\s+(?:se\s+encontr|existe)/i, 'NO ENCONTRADO'],
      ];
      for (const [patron, valor] of barrido) {
        if (patron.test(texto)) {
          salida.estado = valor;
          break;
        }
      }
    }
    if (!('estado' in salida)) {
      salida.estado = 'no verificable';
      salida.motivo = 'la respuesta del timbre no trajo un estado reconocible';
    }
    salida.verificado_en = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch (e) {
    salida.estado = 'no verificable';
    salida.motivo = `consulta de timbre fallo: ${e instanceof Error ? e.name : 'error'}`;
  }
  return salida;
}

// ───────────────────────── 3. Padrón de RNC ─────────────────────────────────

const CAMPOS_RNC: Array<[string, string]> = [
  ['C[eé]dula\\s*/\\s*RNC|RNC\\s*/\\s*C[eé]dula', 'rnc'],
  ['Nombre\\s*/\\s*Raz[oó]n\\s+Social|Raz[oó]n\\s+Social', 'razon_social'],
  ['Nombre\\s+Comercial', 'nombre_comercial'],
  ['Estado', 'estado_contribuyente'],
  ['R[eé]gimen\\s+de\\s+pagos', 'regimen_pagos'],
  ['Actividad\\s+Econ[oó]mica', 'actividad_economica'],
  ['Administraci[oó]n\\s+Local', 'administracion_local'],
  ['Facturador\\s+Electr[oó]nico', 'facturador_electronico'],
];

// Cómo DGII dice "este RNC no existe" (texto literal de la página, 2026-08-03).
const NO_INSCRITO = /no\s+se\s+encuentra\s+inscrito\s+como\s+[Cc]ontribuyente/i;

export async function consultaPadronRnc(rnc: string): Promise<FichaDgii> {
  const salida: FichaDgii = { rnc_consultado: rnc, fuente: 'dgii.gov.do/consultas/rnc' };
  try {
    const r1 = await fetch(URL_RNC, { headers: CABECERAS_GET, signal: AbortSignal.timeout(25_000) });
    if (!r1.ok) {
      salida.estado = 'no verificable';
      salida.motivo = `DGII respondio HTTP ${r1.status}`;
      return salida;
    }
    const pagina = await r1.text();
    const campos: Record<string, string> = ocultos(pagina);
    if (!('__VIEWSTATE' in campos)) {
      throw new Error('la pagina no trajo __VIEWSTATE (cambio de forma?)');
    }
    // El botón BUSCAR no es submit: dispara __doPostBack.
    campos['__EVENTTARGET'] = PREFIJO + 'btnBuscarPorRNC';
    campos['__EVENTARGUMENT'] = '';
    campos[PREFIJO + 'txtRNCCedula'] = rnc;
    campos[PREFIJO + 'txtRazonSocial'] = '';
    campos[PREFIJO + 'hidActiveTab'] = '';
    const r2 = await fetch(URL_RNC, {
      method: 'POST',
      headers: {
        ...CABECERAS_GET,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': URL_RNC,
        'Cookie': cookieDe(r1),
      },
      body: new URLSearchParams(campos).toString(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r2.ok) {
      salida.estado = 'no verificable';
      salida.motivo = `DGII respondio HTTP ${r2.status}`;
      return salida;
    }
    const texto = textoPlano(await r2.text());
    Object.assign(salida, parsearFicha(texto, CAMPOS_RNC, 120));

    if (salida.razon_social) {
      salida.estado = 'ENCONTRADO';
      // El padrón devuelve el RNC formateado (130-27768-2); el resto del
      // pipeline lo usa sin guiones.
      if (salida.rnc) salida.rnc = String(salida.rnc).replace(/[^0-9]/g, '');
    } else if (NO_INSCRITO.test(texto)) {
      // Ojo: ese texto vive en el HTML como validador oculto y está ahí
      // también cuando el RNC sí existe. Solo vale leerlo DESPUÉS de descartar
      // la ficha — de ahí que sea un else-if y no un if.
      salida.estado = 'NO ENCONTRADO';
      salida.mensaje = 'el RNC no se encuentra inscrito como contribuyente';
    } else {
      salida.estado = 'no verificable';
      salida.motivo = 'la respuesta de DGII no trajo ni ficha ni mensaje reconocible';
    }
  } catch (e) {
    salida.estado = 'no verificable';
    salida.motivo = `${e instanceof Error ? e.name : 'error'}: ${
      String(e instanceof Error ? e.message : e).slice(0, 100)
    }`;
  }
  return salida;
}

// ───────────────────────── rescate del NCF leído con un dígito de más ───────

export interface Rescate {
  ncf: string;
  respuesta: FichaDgii;
}

/**
 * Rescate del NCF impreso con UN dígito de más (bloque 5 del fuente). La
 * visión mete un dígito espurio con frecuencia (2026-08-02: leyó B01000000500
 * donde el papel decía B0100000050) y el regex de formato, que está bien
 * puesto porque esto es input hostil, lo descarta entero — y sin NCF no hay
 * DGII ni dedup. Se prueban SOLO las candidatas de borrar un dígito (la letra
 * no se toca), cada una re-validada por el MISMO regex antes de tocar la red,
 * y gana la primera que DGII dé VIGENTE. Si ninguna verifica, no se adivina.
 * La respuesta VIGENTE se devuelve para que el bloque 6 no repita la consulta.
 */
export async function rescatarNcf(crudo: string, rnc: string): Promise<Rescate | null> {
  const vistas: string[] = [];
  for (let i = 1; i < crudo.length; i++) {
    const c = crudo.slice(0, i) + crudo.slice(i + 1);
    if (!vistas.includes(c)) vistas.push(c);
  }
  let intentos = 0;
  for (const cand of vistas) {
    if (!/^B\d{10}$/.test(cand)) continue;
    intentos++;
    if (intentos > 8) break;
    try {
      const resp = await conPlazo(consultaNcfImpreso(rnc, cand), 20_000, 'rescate NCF');
      if (resp.estado === 'VIGENTE') return { ncf: cand, respuesta: resp };
    } catch {
      continue;
    }
  }
  return null;
}
