# Conectar Los Chanchitos a Supabase Free

Estado de esta instalación: el proyecto nuevo ya fue creado, la base y el menú instalados y la aplicación configurada. Dueño y Cajero ya tienen acceso comprobado y operaciones de prueba; ver [el informe Cajero](CAJERO_2026-10-19.md). También se corrigió y comprobó el conflicto de versiones en dos pestañas. Faltan las pruebas ampliadas descritas en [el estado comprobado](ESTADO_SUPABASE.md). No se ha contratado ningún servicio de pago.

Esta guía se conserva como referencia. **No repetir los pasos de creación, instalación o seed en el proyecto `TU-REFERENCIA`: ya están realizados.** Continúa con las cuentas del paso 4.

## 1. Crear el proyecto gratuito

1. Entra en [Supabase](https://supabase.com/dashboard).
2. Como ya utilizas otro proyecto, crea una organización separada llamada **Los Chanchitos**, con plan **Free**. No cambies el plan, miembros ni configuración de la organización anterior. Dentro de la nueva organización pulsa **New project**.
3. Nombre sugerido: **los-chanchitos-desarrollo**.
4. Genera una contraseña para la base de datos y guárdala en tu administrador de contraseñas. No hace falta compartirla por chat.
5. Deja los recursos del plan gratuito y crea el proyecto. No selecciones Pro ni complementos de pago.

Supabase permite dos proyectos gratuitos activos, contando las organizaciones en las que eres Owner o Administrator. Si sólo tienes un proyecto gratuito activo y no existen otras restricciones de cuota, normalmente puedes crear éste como segundo. Una organización nueva no reinicia ese límite. No pauses ni elimines tu proyecto anterior para continuar este avance.

Los proyectos tienen sus propias bases, Auth y archivos. La organización separada permite entregar después el control de Los Chanchitos sin dar acceso a tus otros proyectos. El plan se configura por organización: no crees el proyecto dentro de una organización Pro si quieres mantenerlo Free.

## 2. Preparar la base

### Opción recomendada: instalación inicial protegida

Antes de abrir **SQL Editor**, confirma que el selector del panel diga **los-chanchitos-desarrollo** y que la referencia de su URL sea la del proyecto nuevo. No abras el editor del proyecto que ya utilizas.

Abre `supabase/install_new_project.sql`, copia todo el contenido y ejecútalo en una consulta nueva, una sola vez. Incluye las tres migraciones, el menú y una comprobación previa dentro de una sola transacción. Si algo falla, se revierte esa instalación.

La comprobación se detiene si encuentra tablas, vistas, secuencias, tipos o funciones de una aplicación en `public`, usuarios de Auth o depósitos de Storage. No borres esos objetos para hacer pasar la comprobación: revisa que hayas elegido el proyecto nuevo. Crea las cuentas del personal **después** de instalar.

Esta comprobación reduce el riesgo, pero no identifica el proyecto por su nombre ni detecta cualquier posible uso previo. Por eso no sustituye confirmar nombre y URL en el panel. Nunca ejecutar el instalador sobre el proyecto ajeno a Los Chanchitos.

Si ya aplicaste alguna migración de Los Chanchitos, **no ejecutes el instalador completo ni vuelvas a cargar el menú**. Conserva el estado y revisa qué pasos faltan antes de continuar.

### Alternativa: migraciones por separado

Sólo si se ha confirmado el proyecto nuevo y vacío, se pueden aplicar estos archivos en orden, una sola vez, en lugar del instalador:

1. `supabase/migrations/202610170001_initial_schema.sql`
2. `supabase/migrations/202610180002_staff_orders.sql`
3. `supabase/migrations/202610190003_order_conflict_http.sql`
4. `supabase/seed.sql`

El segundo archivo cierra las escrituras directas y sólo permite las operaciones verificadas. No uses únicamente el primero para conectar usuarios reales.

No combines ambas opciones: si usaste `install_new_project.sql`, los cuatro pasos anteriores ya están incluidos.

Para actualizar una instalación que ya tenía los primeros dos archivos, ejecuta **únicamente la tercera migración**. Ésta corrige el código del conflicto de versión sin borrar datos ni cambiar permisos. Ya fue aplicada al proyecto actual. Consulta [el informe de corrección](CORRECCION_CONCURRENCIA_2026-10-19.md).

Esto crea la sucursal y el menú recibido. No añade recetas ni existencias inventadas. Las migraciones están pensadas para una base nueva de este proyecto; no ejecutarlas sobre otra aplicación.

## 3. Cerrar el registro al público

En **Authentication**, busca la configuración de usuarios o registro:

- Desactiva **Allow new users to sign up**.
- Mantén desactivado el acceso anónimo.
- No se utiliza registro público en la aplicación.

La aplicación también exige un perfil activo de personal. Crear una cuenta de Auth por sí solo no autoriza el acceso.

## 4. Crear las dos cuentas de prueba

En **Authentication → Users → Add user → Create user**, crea una cuenta de Dueño y otra de Cajero con correo y contraseña. Para esta prueba puedes confirmar su correo desde el panel. Usa cuentas de prueba controladas por ti, no datos de clientes.

En SQL Editor, abre `supabase/activate_staff.sql`, reemplaza el correo y nombre y ejecútalo para cada cuenta:

- Dueño: `staff_role := 'owner'`.
- Cajero: `staff_role := 'cashier'`.

Para el Cajero se recomienda la plantilla específica `supabase/activate_cashier.sql`: exige correo y UUID confirmados, fija el rol Cajero y rechaza modificar una cuenta Dueño o de otra sucursal. No ejecutes las dos plantillas para una misma alta ni autorices una identidad que no hayas comprobado. Ver [el estado de la comprobación Cajero](CAJERO_2026-10-19.md).

No uses las opciones de invitación por correo hasta configurar un proveedor de envío. No hay un servicio de correo de pago contratado.

## 5. Conectar la aplicación

En el panel del proyecto, **Connect** o **Settings → API**, localiza:

- La **Project URL**.
- La **Publishable key**, que normalmente empieza con `sb_publishable_`.

Copia `.env.example` como `.env.local` dentro de la carpeta de **Los Chanchitos** y sustituye sus dos valores. Deben pertenecer al proyecto nuevo, nunca al proyecto anterior. No edites el archivo de configuración de tu otra aplicación. Reinicia la aplicación con `npm run dev`; si usas una compilación de producción, configura las variables antes de volver a compilar.

No copies llaves `service_role`, `sb_secret_`, contraseñas de base de datos ni tokens de administración en variables que empiezan con `NEXT_PUBLIC_`.

Cuando las dos variables están configuradas se desactiva la demostración y se exige entrar con una cuenta. En una compilación de producción no se permite demostración, incluso si faltan variables: se muestra acceso pendiente de activar.

## 6. Prueba de aceptación en el proyecto real

1. Abre `/pos` sin sesión: debe dirigirte a acceso.
2. Entra con el Cajero y agrega productos a Mesa 1. Pulsa **Guardar pedido**.
3. Recarga: el pedido debe continuar en Mesa 1 y en **Pedidos**.
4. Abre otro navegador/equipo con el Dueño. **Actualizar pedidos** debe mostrar la misma información.
5. Modifica el mismo pedido en ambos equipos. La versión vieja debe rechazarse sin pisar la nueva.
6. Cobra y recarga. Debe aparecer en **Pagados**, con su ticket y pagos, una sola vez.
7. El Cajero no debe poder cancelar un pedido guardado. El Dueño sí, con motivo.
8. Comprueba dos pedidos distintos para llevar. Deben abrirse por separado desde **Pedidos**.
9. Sal de la cuenta. No debe quedar acceso al POS sin iniciar sesión.

Hasta completar esta lista no se considera verificada la conexión remota. Caja, impresión física, recuperación de contraseña por correo y carga real de recetas siguen siendo etapas posteriores.

## Guardar, actualizar y recuperar

Los cambios son explícitos: **Guardar pedido** confirma que están en la base. Se muestra “Cambios sin guardar” mientras sólo están en pantalla. El navegador advierte al recargar con cambios pendientes. **Actualizar pedidos** pide confirmación antes de descartar ediciones pendientes.

El cobro primero guarda el pedido y luego registra los pagos de forma transaccional. Los reintentos de la misma solicitud no duplican el cobro. PostgreSQL toma los precios y conserva los precios ya guardados en el pedido; no confía en un precio modificado desde el navegador.

## Verificaciones ya realizadas sin costo

`npm test` ejecuta 35 casos: 22 de permisos, integridad e idempotencia en PostgreSQL local con PGlite, seis de funciones puras del POS y siete de instalación protegida. Se comprueba el rechazo de bases usadas, la conservación de sus datos y la reversión completa ante un error. Auth se simula con roles y `auth.uid()`: estos casos automáticos no prueban el servicio de autenticación remoto ni cinco a siete equipos reales.

`npm run supabase:check` confirma que el instalador corresponde a sus fuentes. Es una comprobación local: no se conecta al panel ni modifica proyectos remotos. Para regenerarlo al cambiar las migraciones, `node scripts/supabase-setup.mjs --print` produce el SQL actualizado; sustituye el archivo generado mediante las herramientas de edición del proyecto y vuelve a ejecutar las pruebas.

`npm run build` comprueba la compilación y TypeScript. Después, `npm run test:access` comprueba que la versión de producción no ofrece una entrada pública a la demostración.

Con el proyecto configurado, `npm run supabase:verify -- --project-ref=TU-REFERENCIA` comprueba la conexión y restricciones anónimas con solicitudes de sólo lectura. El argumento debe coincidir con la URL configurada; no se conecta si el destino difiere. No sustituye entrar con cuentas de personal y probar pedidos/cobros.

## Fuentes

- [Integración oficial de Supabase con Next.js](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs).
- [Configuración del registro de usuarios](https://supabase.com/docs/guides/auth/general-configuration).
- [Funciones de base de datos y permisos](https://supabase.com/docs/guides/database/functions).
- [PGlite para PostgreSQL local](https://pglite.dev/docs/).
- [Límite de proyectos gratuitos y planes por organización](https://supabase.com/docs/guides/platform/billing-faq).
- [Control de miembros y entrega de la organización](https://supabase.com/docs/guides/platform/access-control).
