# Revisión responsive y sesiones · 19 de octubre de 2026

## Resultado comprobado

Se revisó el acceso en 320×568, 390×844, 768×1024, 1024×768 y 1366×900 píxeles. El formulario no desborda horizontalmente y el botón de acceso mantiene un tamaño utilizable.

El POS autenticado se comprobó en desarrollo y, después de compilar, en producción local. En producción se verificaron ocho tamaños: 320×568, 390×844, 768×1024, 900×600, 901×600, 1024×768, 1366×900 y 844×390. Los 26 productos se conservan y no aparece desbordamiento horizontal del documento. Se incluyó el cambio entre navegación inferior y lateral, a 900/901 píxeles.

La medición se hizo con dimensiones efectivas leídas del navegador, no suponiendo que la captura visible equivalía a un dispositivo. La pestaña visible no aplicaba la dimensión solicitada; se usó una pestaña de pruebas del mismo navegador cuya anchura/altura sí coincidían. Esto es emulación de tamaño, no certificación en iPad, Android o iPhone físicos ni de sus teclados virtuales.

## Corrección realizada

En 320×568, el pedido abierto dejaba acciones detrás de la navegación inferior. Antes de corregir, “Ver comanda” estaba entre y=519 y 567 y “Vaciar pedido” entre y=572 y 608, mientras el panel acababa en y=501.

Se permitió desplazar el panel completo del pedido en móvil, sin comprimir sus secciones. Las cantidades tienen botones de 44×44 píxeles. No se modificaron autenticación, permisos, precios ni lógica de cobro.

Después de corregir, se pudo abrir la confirmación de vaciado y conservar el borrador. En producción, el desplazamiento del panel fue de 176 píxeles y “Vaciar pedido” quedó entre y=425 y 461, dentro del panel. También se abrió y cerró la comanda correctamente.

## Flujo sin ventas nuevas

- Agregar un Tacos, abrir el pedido móvil y aumentar la cantidad: total de $25 a $50.
- Abrir/cerrar comanda sin imprimir ni guardar.
- Abrir cobro: $20 recibidos deshabilitan la confirmación para un total de $25; $25 la habilitan. **No se pulsó Confirmar pago.**
- Vaciar únicamente el borrador nuevo sin guardar; no se canceló ningún pedido persistido.
- Buscar “ceMITas”: un producto; borrar búsqueda y recuperar el catálogo.
- Abrir Menú en 320 píxeles: 26 filas y sin desbordamiento horizontal del documento.

No se ejecutaron operaciones de guardado, cobro o cancelación de pedidos en Supabase durante esta revisión responsive. No se inventaron recetas, cajas o movimientos de dinero. Las pruebas de producción se hicieron en un servidor local, sin desplegar.

## Pruebas automatizadas

**55 pruebas locales aprobadas**: 24 de PostgreSQL/permisos, 14 de solicitudes, seis de lógica del POS y once de instalación/actualización/activación.

Se añadieron dos regresiones aisladas de trabajo entre roles: conservar autor y rechazar edición/cancelación con versión vieja tras un cambio del otro usuario; y cobrar el pedido del otro rol, conservando quién lo creó y quién recibió el pago, sin duplicar pago ni ticket. Son identidades simuladas en PostgreSQL local y operaciones intercaladas, no una prueba real de carga o de bloqueo simultáneo de cinco a siete conexiones.

También aprobados: `npm run build`, `npm run test:access` y `npm run supabase:check`. No se ejecutó lint en esta revisión.

## Sesiones reales: acceso y salida separados comprobados

Se prepararon dos direcciones locales, `127.0.0.1:3000` y `localhost:3000`, para separar las cookies por host dentro del mismo navegador. No son dos navegadores ni dos dispositivos independientes. El usuario introduce sus credenciales personalmente.

El usuario completó el segundo acceso. Se verificaron simultáneamente Dueño en `127.0.0.1` y Cajero de prueba en `localhost`, leyendo las identidades visibles después de recargar. Dueño muestra Caja/Inventario; Cajero no muestra esos accesos. No se cambiaron roles para conseguir la prueba.

Ambas cuentas recuperaron el mismo historial actual: cero pedidos abiertos y cinco pagados visibles. Hay un registro adicional respecto a la auditoría anterior (Frijoles · 1 litro, $70); esta revisión del agente no pulsó Guardar pedido ni Confirmar pago. No se deduce su origen ni se recalculan los totales de la auditoría anterior a partir de esta observación.

Se cerró la sesión del Cajero, se comprobó su regreso a login y se recargó el Dueño: continuó autenticado con su identidad y navegación. Finalmente se cerró la sesión Dueño; las dos pestañas originales, recargadas, exigieron acceso. Esto comprueba sesiones de cuentas distintas separadas por host y salida de Cajero sin cerrar al Dueño, no sesiones del mismo usuario ni navegadores/equipos físicos independientes.

No se ejecutaron escrituras cruzadas sobre un pedido real en esta ronda. Las regresiones de edición/cancelación/cobro entre roles se ejecutaron sólo en PostgreSQL local. Siguen pendientes carga de cinco a siete usuarios, dispositivos físicos y pruebas ampliadas de red.

## Evidencia

Capturas en la carpeta superior `outputs`: `pos-pedido-320-antes.png`, `pos-pedido-320-corregido.png`, `pos-produccion-movil-corregido.png`, `pos-produccion-celular-390.png`, `pos-produccion-tablet-768.png`, `acceso-celular-390.png` y `acceso-tablet-768.png`.

Evidencia de sesiones: `sesion-dueno-independiente.png`, `sesion-cajero-independiente.png` y `dueno-conserva-sesion-tras-salir-cajero.png`.

Se utilizó la guía de Sites sólo para el ciclo local de revisión, compilación y comprobación visual. No se publicó una web ni se contrataron servicios.

El servidor temporal de producción (3181) se detuvo después de las pruebas. El desarrollo (3000) se retuvo durante la entrega de control al usuario para completar el segundo inicio de sesión y se detuvo al terminar la comprobación. Se cerraron ambas sesiones y las pestañas temporales de pruebas; la pestaña de Supabase del usuario se conserva. Para retomar: `npm run dev` e ingreso personal.
