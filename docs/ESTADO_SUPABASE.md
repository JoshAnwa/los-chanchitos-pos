# Estado de la conexión · Los Chanchitos

Actualización: 19 de octubre de 2026. La instalación y pruebas iniciales son del 18 de octubre.

Se identificó y corrigió el error que marcaba los conflictos de versión como fallos reintentables `40001`. Las tres funciones ahora usan `PT409`, conservando permisos y datos existentes. Pasaron 51 pruebas locales, la verificación remota de las definiciones y la prueba visible de guardar, cobrar y cancelar desde una versión antigua en dos pestañas. El pedido QA 0008 se canceló sin pagos. Consulta [la corrección de concurrencia](CORRECCION_CONCURRENCIA_2026-10-19.md). Los informes anteriores conservan su contexto histórico.

Actualización posterior: **Cajero de prueba creado por el usuario, activado con su autorización y comprobado en la aplicación**. Se conservó al Dueño sin cambios. La cancelación quedó bloqueada y se guardó/cobró un pedido QA de $25 con un solo pago y ticket. Ahora hay 53 pruebas locales aprobadas. Ver [el informe Cajero](CAJERO_2026-10-19.md).

## Proyecto autorizado

- Organización: Los Chanchitos, plan Free.
- Proyecto: los-chanchitos-desarrollo.
- Referencia: `TU-REFERENCIA`.
- URL pública: `https://TU-PROYECTO.supabase.co`.
- Región observada: East US, North Virginia (`us-east-1`).

Se comprobó el destino en el panel antes de instalar. No se accedió ni se realizaron cambios en el proyecto anterior del desarrollador. No se contrató ni cambió ningún servicio de pago.

## Instalación realizada

Se ejecutó `supabase/install_new_project.sql` una sola vez en el proyecto nuevo. El editor confirmó `Success. No rows returned`. **No volver a ejecutar el instalador ni el seed sobre esta base.**

La consulta de sólo lectura `supabase/verify_installation.sql` confirmó:

- 15 tablas de aplicación y las 15 con RLS habilitado.
- 26 productos del menú y una sucursal.
- Cero ingredientes y cero cuentas de Auth al terminar la instalación; no se inventaron datos.
- El rol autenticado tiene acceso al esquema y a la consulta de pedidos, pero no puede insertar pedidos directamente ni cambiar perfiles mediante escrituras directas.
- El acceso anónimo no puede leer productos ni ejecutar la consulta de pedidos.
- La función antigua `complete_sale` no es ejecutable por el personal.

La aplicación local quedó configurada mediante `.env.local` con la URL y llave **publicable** de este proyecto. El archivo está excluido del control de versiones; no incluye llave administrativa ni contraseña de base de datos.

## Acceso cerrado

Se desactivó **Allow new users to sign up** y se comprobó después de recargar el panel. El inicio anónimo permanece desactivado y la confirmación de correo activada. El personal se crea administrativamente y después se activa mediante `activate_staff.sql`.

La comprobación remota de sólo lectura fue satisfactoria:

```text
npm run supabase:verify -- --project-ref=TU-REFERENCIA
```

Verificó Auth accesible, registro público deshabilitado y rechazo por permisos de las consultas anónimas de catálogo y pedidos. No creó usuarios, pedidos ni datos de prueba remotos.

La compilación con el proyecto configurado terminó correctamente; `/login` y `/pos` se renderizan por sesión. La prueba de acceso de producción confirmó la redirección a login y que no se ofrece demostración sin sesión.

## Pendiente antes de operar

La primera cuenta de prueba ya fue creada por el usuario y activada con su autorización como `owner`. Se verificó en la base real: rol `owner`, `is_active=true` y sucursal **Los Chanchitos · Matriz**. El SQL se limitó al identificador de la cuenta confirmada, sin modificar otras cuentas. No se leyó ni guardó su contraseña.

El usuario ya completó el ingreso directamente en la aplicación y confirmó su acceso. Se comprobó visualmente el POS autenticado, el catálogo con los precios de Supabase y el historial inicialmente vacío (cero pedidos y cero pagados). Esto valida el ingreso real del Dueño y la lectura del catálogo; no sustituye probar operaciones de pedidos o el rol Cajero.

Se realizaron las pruebas autorizadas de guardado, recarga, cancelación, pedidos para llevar, cobro combinado, efectivo, transferencia simulada, recuperación de tickets y cierre de sesión. La auditoría real confirmó cinco pedidos QA: tres pagados de prueba por $75 y dos cancelados, sin pedidos abiertos ni movimientos de inventario o cajas creadas. No se borraron estos registros. Consulta [el informe de pruebas](PRUEBAS_2026-10-18.md).

1. Ampliar las pruebas a navegadores/equipos independientes y distintas cuentas. La incidencia de versiones antiguas ya se comprobó resuelta en dos pestañas, sin sobrescribir la versión vigente.
2. Completar las pruebas cruzadas con Dueño y Cajero en navegadores independientes. La cuenta Cajero ya está creada, activada y probada individualmente; crear Auth por sí solo no activa el acceso.
3. Completar pruebas en móvil/tablet físicos, carga de cinco a siete usuarios y recuperación ante fallos de red. La revisión de ocho tamaños emulados ya está documentada en `RESPONSIVE_SESIONES_2026-10-19.md`.
4. Usar una contraseña exclusiva para el usuario del POS, distinta a la de la base de datos, antes de operar con ventas reales.

Las 55 pruebas automáticas locales fueron aprobadas, incluidas dos regresiones nuevas de operaciones intercaladas entre roles, pero siguen siendo comprobaciones aisladas, no una prueba de cinco a siete equipos ni una autorización para usar el sistema en ventas reales. La auditoría más reciente tiene nueve pedidos QA, cuatro pagados por $100 de desarrollo, cinco cancelados y ninguno abierto. La revisión responsive posterior no ejecutó nuevos guardados ni cobros remotos. Caja completa, recetas, impresora y copias de respaldo operativas siguen pendientes.
