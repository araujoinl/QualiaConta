// Test de la lista blanca (F4, precondición 2): las rutas negadas tiran
// excepción ANTES de la red. Sin mock de HTTP y SIN --allow-net: si el cliente
// intentara un request de verdad, Deno moriría con PermissionDenied — un error
// DISTINTO de ErrorListaBlanca — y el assert lo delataría igual.
//
// Correr:  deno test supabase/functions/_shared/adm.test.ts   (sin permisos)

import { assert, assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert@1';
import { AdmCliente, ErrorListaBlanca, sanear, verificarRuta } from './adm.ts';
import type { CredAdm } from './adm.ts';

const CRED: CredAdm = {
  codigo: 'EMPRESA-X',
  api_role: 'Contabilidad Digital',
  api_appid: 'appid-x',
  api_username: 'u',
  api_password: 'p',
};

Deno.test('las rutas negadas mueren antes de la red', () => {
  const casos: [string, string][] = [
    ['POST', 'VendorBills/Void'],
    ['PUT', 'BankCharges/void'],
    ['POST', 'Journals/Void'],
    ['POST', 'VendorBills/electronicsign'],
    ['POST', 'VendorBills/removesign'],
    ['DELETE', 'VendorBills'],
    ['DELETE', 'Journals'],
    ['POST', 'CustomReports/Execute'],
    ['POST', 'CustomReports/ExecuteScalar'],
    ['POST', 'SaveBankFeeds'],
    ['POST', 'BankFileImport'],
    ['POST', 'CreditInvoices'],
    ['POST', 'CashInvoices'],
    ['POST', 'CustomerPayments'],
    ['POST', 'Quotes'],
    ['POST', 'Items'], // maestro: lo crea un humano en la UI
    ['POST', 'Accounts'],
    ['POST', 'FiscalSequences'],
    ['PUT', 'VendorBills/abc-123'], // editar documentos es del humano
    ['PUT', 'Journals/Authorize'], // sólo los DOS Authorize de pagos
  ];
  for (const [metodo, ruta] of casos) {
    assertThrows(() => verificarRuta(metodo, ruta), ErrorListaBlanca, undefined, `${metodo} ${ruta}`);
  }
});

Deno.test('las permitidas pasan el candado', () => {
  const casos: [string, string][] = [
    ['GET', 'VendorBills'],
    ['GET', 'BankCharges/uuid-x'],
    ['POST', 'VendorBills'],
    ['POST', 'VendorCreditNotes'],
    ['POST', 'BankCharges'],
    ['POST', 'BankBankTransfers'],
    ['POST', 'Journals'],
    ['POST', 'BillPayments'],
    ['POST', 'AccountPayments'],
    ['POST', 'Vendors'],
    ['POST', 'Storage'],
    ['PUT', 'BillPayments/Authorize'],
    ['PUT', 'AccountPayments/Authorize'],
  ];
  for (const [metodo, ruta] of casos) verificarRuta(metodo, ruta);
});

Deno.test('el cliente frena la ruta negada sin tocar la red (y con stub tampoco sale)', async () => {
  let salioUnRequest = false;
  const stub = (() => {
    salioUnRequest = true;
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  const cli = new AdmCliente(CRED, stub);
  await assertRejects(() => cli.llamar('POST', 'VendorBills/Void', {}), ErrorListaBlanca);
  assertEquals(salioUnRequest, false);
});

Deno.test('la query viaja encodeada y con las tres llaves', async () => {
  let url = '';
  const stub = ((entrada: URL | RequestInfo) => {
    url = String(entrada);
    return Promise.resolve(new Response(JSON.stringify({ success: true, data: [] })));
  }) as typeof fetch;
  const cli = new AdmCliente(CRED, stub);
  await cli.get('VendorBills', { skip: 0 });
  assert(url.includes('company=EMPRESA-X'));
  // el rol lleva ESPACIO: sin encodear da HTTP 000 (~31s perdidos por factura)
  assert(url.includes('role=Contabilidad+Digital') || url.includes('role=Contabilidad%20Digital'));
  assert(url.includes('appid=appid-x'));
  assert(url.includes('skip=0'));
});

Deno.test('readback: data null es error, no ausencia (🪦 NCP00000006)', async () => {
  const stub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true, data: null })),
    )) as typeof fetch;
  const cli = new AdmCliente(CRED, stub);
  await assertRejects(() => cli.readback('VendorBills', 'uuid-de-una-ncp'), Error, 'readback vacío');
});

Deno.test('paginar entiende la tupla {Item1:[filas], Item2:total} de BankBankTransfers', async () => {
  // Forma medida contra producción el 2026-08-20: data NO es la lista — es un
  // objeto con las filas en Item1 y el conteo total en Item2.
  let llamadas = 0;
  const stub = (() => {
    llamadas++;
    const filas = llamadas === 1
      ? Array.from({ length: 50 }, (_, i) => ({ DocID: `TE${i}` }))
      : [{ DocID: 'TE50' }];
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: { Item1: filas, Item2: 216 } })),
    );
  }) as typeof fetch;
  const cli = new AdmCliente(CRED, stub);
  const filas = await cli.paginar('BankBankTransfers');
  assertEquals(filas.length, 51);
  assertEquals(filas[0], { DocID: 'TE0' });
  assertEquals(llamadas, 2);
});

Deno.test('paginar sigue entendiendo la lista plana', async () => {
  const stub = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true, data: [{ DocID: 'FP1' }, { DocID: 'FP2' }] })),
    )) as typeof fetch;
  const cli = new AdmCliente(CRED, stub);
  const filas = await cli.paginar('VendorBills');
  assertEquals(filas.map((f) => f.DocID), ['FP1', 'FP2']);
});

Deno.test('sanear borra la company de los textos', () => {
  assertEquals(sanear('error en EMPRESA-X: algo', CRED), 'error en <company>: algo');
});
