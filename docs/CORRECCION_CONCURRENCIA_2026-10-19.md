# Corrección del bloqueo por conflicto de versión · 19 de octubre de 2026

## Causa identificada

Las funciones `save_pos_order`, `pay_pos_order` y `cancel_pos_order` devolvían `ORDER_CHANGED` con SQLSTATE **40001**. Ese código representa un fallo de serialización transitorio, no un conflicto definitivo de la versión del pedido. Las pruebas PostgreSQL aisladas detectaban la excepción correctamente, pero no incluían la capa HTTP de PostgREST.

Supabase documenta que usar 40001 de esta forma puede hacer que PostgREST reintente indefinidamente la transacción. Es coherente con la reproducción: los guardados normales terminaban, mientras que un pedido antiguo quedaba esperando sin sobrescribir los datos.

Referencia primaria: [Supabase: SQLSTATE 40001 en funciones RPC](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b). La solución documentada permite usar **PT409** para responder HTTP 409 sin el bucle de reintento.

## Corrección aplicada

- Se agregó `supabase/migrations/202610190003_order_conflict_http.sql` y se ejecutó únicamente en **los-chanchitos-desarrollo**, referencia `TU-REFERENCIA`.
- Cambia exclusivamente el código del error `ORDER_CHANGED` a `PT409` en las tres funciones. Conserva el mensaje que reconoce la interfaz, las validaciones, los bloqueos, la versión y la idempotencia.
- La migración comprueba las firmas y el fragmento esperado. Si encuentra una definición inesperada, se detiene y revierte toda la actualización. Se puede reaplicar sin modificar datos.
- `CREATE OR REPLACE` conserva los propietarios y permisos. No se reinstaló la base, no se cargó de nuevo el menú y no se alteraron cuentas.
- Se conserva la protección de 15 segundos frente a otros fallos de conexión. Ya no se usa como sustituto de corregir el conflicto.
- El instalador para proyectos **nuevos** ahora incluye las tres migraciones. Nunca se debe ejecutar ese instalador sobre el proyecto existente para actualizarlo.

No hizo falta añadir diagnósticos temporales, modificar el SDK, desactivar seguridad, reiniciar el proyecto ni terminar conexiones: la consulta previa y posterior no encontró solicitudes activas de pedidos antiguas.

## Verificación de instalación remota

`supabase/verify_conflict_fix.sql` es exclusivamente de lectura. Comparación antes/después, previa a nuevos pedidos QA:

- Tres funciones: de `retries_40001=true, conflict_409=false` a `retries_40001=false, conflict_409=true`.
- Permisos idénticos: propietario postgres y ejecución autenticada; sin ejecución anónima. Se conservaron `SECURITY DEFINER` y `search_path` vacío.
- Registros idénticos: siete pedidos, tres pagados de desarrollo, cuatro cancelados y ninguno abierto; cuatro partidas de pago por $75 de pruebas previas; 26 productos; 15 tablas con RLS.
- Ninguna solicitud activa de guardar/cobrar/cancelar. No se desconectaron usuarios ni se detuvieron procesos.

## Regresión local

**51 pruebas aprobadas.** Se actualizaron las comprobaciones para exigir `PT409`, no sólo que el mensaje contenga `ORDER_CHANGED`.

Dos casos nuevos prueban una instalación antigua real en PostgreSQL local: verifican el error 40001 antes de actualizar y PT409 después para guardar, cobrar y cancelar; mantienen pedidos, versiones, importes, pagos, permisos y configuración. También comprueban reaplicación y rollback de toda la migración si una función no coincide con la versión esperada.

El caso del SDK simula una respuesta HTTP 409 con `PT409` y exige el mensaje de conflicto sin reenvío automático. No sustituye la prueba visible contra la API real.

Comprobaciones satisfactorias de esta corrección:

```text
npm test
npm run supabase:check
npm run supabase:verify -- --project-ref=TU-REFERENCIA
npm run build
npm run test:access
```

La verificación pública fue sólo de lectura: el registro público continúa cerrado y no se permiten consultas de datos sin sesión. El servidor temporal de producción de la prueba de acceso se cerró automáticamente.

## Prueba visible

**Aprobada contra la API real**, con dos pestañas del mismo navegador y la cuenta Dueño. El usuario inició sesión personalmente; no se obtuvo ni se solicitó su contraseña.

1. A guardó el pedido **0008**, Mesa 1, un Tacos de $25, nota `QA-20261019-FIX` y versión 1.
2. B cargó esa versión. A guardó una nota nueva, versión 2.
3. B intentó cobrar su pedido guardado sin cambios locales: recibió `ORDER_CHANGED`, no se registró pago.
4. B intentó cancelar con su versión antigua: recibió el mismo conflicto, no se canceló el pedido.
5. B añadió otro Tacos e intentó guardar $50: recibió el conflicto, conservó su borrador y recuperó los botones.
6. A recargó y confirmó una unidad, $25 y su nota vigente: ninguna operación antigua la sobrescribió.
7. B pulsó Actualizar pedidos, confirmó descartar sólo sus cambios QA y recuperó la versión 2. La nota y el total eran correctos.
8. B guardó una nueva nota normalmente (versión 3) y canceló el pedido con motivo de prueba (versión 4). A recargó y confirmó Mesa 1 libre.

Tiempo observado desde pulsación hasta aviso de conflicto: **429 ms en cobro, 405 ms en cancelación y 291 ms en guardado**. Estas mediciones incluyen interacción de la herramienta y respuesta de la interfaz; no son una prueba de rendimiento ni una garantía de latencia. Ninguna dependió del vencimiento de 15 segundos.

La auditoría final de sólo lectura confirmó **0008 cancelado, versión 4, total $25, una unidad, cero pagos y cero tickets**. Totales del proyecto tras la prueba: ocho pedidos, tres pagados QA anteriores, cinco cancelados, cero abiertos, cuatro partidas de pago por los mismos $75 de desarrollo, y ninguna solicitud de pedidos activa. No se borraron registros de auditoría ni se movió dinero.

Evidencias en la carpeta superior `outputs`: `qa-conflicto-guardado-corregido.jpg`, `qa-conflicto-cobro-corregido.jpg`, `qa-conflicto-migracion-verificada.jpg` y `qa-conflicto-auditoria-final.jpg`.

La incidencia **INC-01 queda resuelta para el caso reproducible de versiones antiguas**. No equivale a aprobar navegadores independientes, distintas cuentas ni una carga de cinco a siete usuarios.

Al concluir se cerró la sesión del POS, se cerraron las pestañas temporales de prueba y se detuvo el servidor local. Para retomar el avance: `npm run dev` desde la carpeta del proyecto e ingreso personal. No se borraron pedidos de auditoría.

## Límites que permanecen

Resolver este defecto no certifica por sí solo cinco a siete usuarios, el rol Cajero real, todos los tamaños de pantalla ni la impresión física. No se contrataron servicios ni se publicó la aplicación; la guía de Sites se siguió en modo local.
