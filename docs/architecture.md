# Arquitectura de Los Chanchitos POS

El personal usa el POS desde el navegador. Next.js y React sirven la aplicación en Netlify. Supabase Auth valida las sesiones y PostgreSQL conserva los registros de cada sucursal.

## Componentes

| Ubicación | Responsabilidad |
| --- | --- |
| [src/app](../src/app/) | Inicio de sesión, navegación y pantallas de venta y administración |
| [src/lib](../src/lib/) | Reglas de presentación, manejo de solicitudes y acceso a Supabase |
| [supabase/migrations](../supabase/migrations/) | Esquema, políticas de acceso, funciones y cambios de base de datos |
| [supabase/seed.sql](../supabase/seed.sql) | Una sucursal y el catálogo inicial |
| [tests](../tests/) | Pruebas de lógica, solicitudes, base de datos y acceso sin sesión |

## Acceso

Supabase Auth inicia la sesión del personal. PostgreSQL usa políticas de seguridad por fila (RLS) y valida que el perfil esté activo y tenga una sucursal asignada. Las funciones de administración comprueban el rol Dueño. Las altas de usuarios se hacen desde el panel administrativo y cada perfil requiere activación.

## Pedidos, cobros e inventario

`save_pos_order` toma los precios de la base, comprueba la versión del pedido y evita que haya dos pedidos abiertos en la misma mesa. `pay_pos_order` asocia el cobro al turno abierto y registra el pago, el ticket y los movimientos de inventario en una transacción. Los reintentos con el mismo identificador conservan un solo cobro. `cancel_pos_order` pide rol Dueño y un motivo para cancelar pedidos guardados sin pagar.

El sistema descuenta ingredientes al cobrar si el producto tiene receta y control de inventario activo. Si falta stock, la transacción se revierte. El inventario se prepara desde la aplicación con ingredientes, compras, conteos y recetas.

Los pedidos guardados se pueden retomar después. El personal pulsa **Actualizar pedidos** para consultar los cambios de otros equipos. La impresión de comandas y tickets usa el diálogo del navegador.

## Instalación y verificación

[El instalador SQL](../supabase/install_new_project.sql) reúne las seis migraciones y el menú inicial en una transacción para bases nuevas. Para una instalación existente se aplican sólo las migraciones pendientes. [Instrucciones de configuración](CONECTAR_SUPABASE_GRATIS.md).

Los informes fechados de esta carpeta documentan pruebas de desarrollo. El [README](../README.md) describe el alcance de la versión incluida y enlaza los materiales de la entrega escolar.
