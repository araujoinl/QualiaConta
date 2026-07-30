# Núcleo DGII

La memoria fiscal compartida. Se monta de **sólo lectura** en todas las
instancias: ninguna empresa escribe acá.

```
normas/<año>/<norma>.md              regla destilada (el PDF va al lado, fuera de git)
interpretaciones/<fuente>/<tema>.md  boletínes de terceros
INDEX.md                             qué hay, con vigencias
```

## Contrato de una regla

Toda regla lleva **rango** y **vigencia**. Sin las dos, no entra.

```markdown
# Retención de ISR a personas físicas por servicios

- **Rango:** norma
- **Fuente:** Norma General 07-2007, artículo 3
- **Vigente desde:** 2007-05-15
- **Vigente hasta:** —
- **Dice:** ...
- **En la práctica:** ...
```

**Rango** es de dónde viene y cuánto pesa: `norma` (texto oficial de la DGII, es
la autoridad), `interpretación` (boletín de EY, Deloitte, PwC — ayuda a
entender, no manda). El `criterio propio` no vive acá: vive en la memoria de la
empresa, porque aplica a esa empresa y no a todas.

Cuando una norma y una interpretación se contradicen, gana la norma. Siempre.

**Vigencia** existe porque una factura de 2025 se juzga con las reglas de 2025.
Un núcleo que sólo sepa "lo que rige hoy" registra mal cualquier documento
atrasado y no avisa. Una regla derogada no se borra: se le pone fecha de fin.

## Cómo se alimenta

Cron semanal que raspa los listados de la DGII, detecta lo que no estaba,
descarga el PDF y destila la regla. Después avisa por Telegram qué cambió y a
qué empresas afecta.

- [Normas Generales](https://dgii.gov.do/legislacion/normasGenerales/Paginas/default.aspx)
- [Avisos Informativos](https://dgii.gov.do/publicacionesOficiales/avisosInformativos/Paginas/default.aspx)

La DGII no publica RSS ni API: es raspado de HTML y descarga de PDF, así que se
rompe cuando ellos cambien el sitio. **Si el raspado falla tiene que avisar** —
un vigilante que falla callado es peor que no tenerlo, porque da la sensación de
estar al día.

Se construye en la entrega 4. Hasta entonces el núcleo se carga a mano con lo
básico: ITBIS, retenciones, comprobantes fiscales y las obligaciones 606 y 607.
