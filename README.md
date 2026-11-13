# Los Chanchitos POS

Punto de venta interno para una taquería con cinco mesas y servicio para llevar. El personal toma pedidos, prepara la comanda y registra el cobro. El dueño administra caja, precios, ingredientes y ventas desde la misma aplicación.

[Abrir la aplicación](https://los-chanchitos-pos.netlify.app/login) · El acceso requiere una cuenta de personal activa.

## Entrega escolar

| Material | Contenido |
| --- | --- |
| [Presentación PowerPoint](docs/entrega/presentacion.pptx) | Problema, solución, recorrido del POS y alcance del proyecto |
| [Guion de la presentación](docs/entrega/guion-del-pitch.pdf) | Notas para exponer y mostrar la aplicación |
| [Guía para computadora](docs/entrega/guia-computadora.pdf) | Operación y administración con capturas anotadas |
| [Guía para celular](docs/entrega/guia-celular.pdf) | Navegación móvil y pasos numerados sobre las pantallas |
| [Arquitectura](docs/architecture.md) | Aplicación, autenticación, base de datos y permisos |
| [Código](src/) · [Base de datos](supabase/) · [Pruebas](tests/) | Implementación, migraciones y verificación local |

## Qué permite hacer

- **Pedidos.** Guardar y retomar pedidos por mesa o para llevar, agregar notas de cocina y consultar o imprimir la comanda.
- **Cobros y caja.** Registrar efectivo, tarjeta, transferencia o pagos combinados, emitir tickets y hacer el corte del turno.
- **Administración.** Editar el menú, registrar compras y conteos, configurar recetas, consultar ventas por fecha y modificar los datos que salen en el ticket.
- **Permisos.** El Cajero toma pedidos y cobra con caja abierta. El Dueño también abre y cierra caja, administra el catálogo y cancela pedidos guardados sin pagar.

El menú inicial contiene 26 productos. El inventario comienza vacío y el descuento automático se aplica al cobrar los productos con control de inventario habilitado y receta configurada.

## Ejecutar en tu equipo

Requiere Node.js 24. En la raíz del repositorio ejecuta:

```sh
npm ci
npm run dev
```

Abre `http://localhost:3000` o la dirección que indique la terminal. En desarrollo, la aplicación muestra una demostración en memoria si no hay variables de Supabase. Puedes recorrer el POS sin una cuenta en ese modo local.

Para guardar datos y usar cuentas reales, copia `.env.example` a `.env.local` y agrega la URL y la llave **publicable** de tu proyecto de Supabase. En un proyecto vacío, ejecuta [el instalador SQL](supabase/install_new_project.sql), desactiva el registro público y configura las cuentas de personal con [la plantilla de activación](supabase/activate_staff.sql). En una base existente aplica sólo las migraciones pendientes. [Guía de conexión](docs/CONECTAR_SUPABASE_GRATIS.md).

## Pruebas

```sh
npm test
npm run supabase:check
npm run build
npm run test:access
```

Las pruebas de base de datos usan PostgreSQL local mediante PGlite. La prueba de acceso verifica que la compilación de producción solicite inicio de sesión al abrir el POS. `supabase:check` comprueba que el instalador SQL coincida con las migraciones y el menú inicial.

## Publicación y pendientes

La aplicación está alojada en Netlify y usa Supabase para la base de datos y las cuentas. [netlify.toml](netlify.toml) configura la compilación. Las dos variables de [.env.example](.env.example) se definen en el alojamiento.

Para la entrega al negocio quedan por confirmar las cuentas definitivas, la operación con los equipos del local y la prueba de impresión. El envío automático de comandas a cocina, la administración de usuarios desde el POS y la versión instalable quedan para una etapa posterior.
