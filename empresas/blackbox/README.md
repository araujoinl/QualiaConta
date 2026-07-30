# Blackbox

Empresa piloto. Se prueba el patrón completo acá antes de conectar una segunda.

## Estado

**Entrega 1 — lectura.** El contable de Blackbox **no escribe nada en ADM
Cloud**. Lee y responde.

## Estructura

```
.env                          credenciales. Fuera de git, siempre
compose.yaml                  copiado de deploy/compose.example.yaml
hermes/
  memoria/                    curada por el agente: proveedores, cuentas, criterios
  libro-de-accion/            append-only, en git. Una decisión = un archivo nuevo
  skills/                     las que trae + las que el agente escriba
liquidaciones/                material de importaciones. Fuera de git
```

## Antes de habilitar escritura

Cuando pasemos a la entrega 2, el usuario de ADM Cloud de Blackbox tiene que
tener el rol recortado: **sin permiso de anular, sin permiso de emitir e-CF de
venta, sin permiso de declarar**. Es requisito de puesta en marcha, no una
mejora posterior — ver [SPEC §5](../../SPEC.md).

En la entrega 1 no aplica, porque el acceso es de sólo lectura.
