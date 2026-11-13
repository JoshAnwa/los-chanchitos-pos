# Avance del sistema · Los Chanchitos

Fecha: 18 de octubre de 2026

## Objetivo

Desarrollar un sistema sencillo de punto de venta para registrar pedidos, mandar comandas a cocina, cobrar y llevar el control básico del negocio. Está pensado principalmente para usarse en una tablet.

## Información recibida del negocio

- Una sucursal.
- Cinco mesas.
- Pedidos para mesa y para llevar.
- El sistema debe mandar comandas a cocina, registrar pedidos y cobrar.
- El negocio no quiere manejar estados complicados; para ellos el flujo es pedido y pagado.
- Requieren ticket físico y comprarán una impresora térmica.
- No manejan descuentos ni promociones.
- Formas de pago previstas: efectivo, tarjeta, transferencia y pago combinado.
- Apertura y corte de caja.
- Dos tipos de usuario: Dueño y Cajero.
- Entre cinco y siete usuarios simultáneos.
- Sin módulo de clientes frecuentes.

## Menú cargado

Se cargaron 26 opciones con los precios proporcionados: tacos, cemitas, tacos dorados, venta por kilo, platillos, desayunos, comida corrida, bebidas, botana, comida por litro, arroz, frijoles y orden de sopa o crema.

Los nombres ambiguos se conservaron lo más cercanos posible al mensaje original. No se inventaron ingredientes, recetas ni existencias.

## Avance funcional

- Pantalla de acceso preparada para Dueño y Cajero.
- Punto de venta adaptable a tablet, computadora y celular.
- Selección entre las cinco mesas o pedido para llevar.
- Menú real organizado por categorías.
- Búsqueda de productos.
- Carrito con cantidades, eliminación y total automático.
- Vista previa de comanda para cocina, con notas e impresión desde el navegador.
- Cobro con efectivo, tarjeta, transferencia o pago combinado.
- Confirmación de pedido pagado.
- Ticket imprimible.
- Base de datos diseñada para productos, pedidos, pagos, caja, tickets, compras e inventario.
- Seguridad por roles y usuarios mediante Supabase Auth.

## Alcance del prototipo

El prototipo local sin configuración permite demostrar el recorrido principal del negocio sin necesitar cuentas, impresora o base de datos en línea. En ese modo, los pedidos de prueba duran mientras la página esté abierta y se reinician al recargar. La instalación de desarrollo actual ya usa el proyecto nuevo de Supabase y exige cuentas de personal. Dueño y Cajero ya fueron activados y se comprobaron sus ingresos reales y operaciones controladas de pedidos y cobros. El historial completo, la operación de caja y la interfaz de inventario quedan para la siguiente etapa.

## Base de datos y acceso interno

Se preparó el guardado de pedidos por mesa y para llevar, recuperación al entrar, cobro combinado y cancelación por el Dueño con motivo. Se añadieron comprobaciones para evitar duplicar cobros y sobrescribir cambios hechos desde otro equipo. Los precios se validan en la base, no se aceptan libremente desde el navegador.

El acceso en producción queda reservado a cuentas activas de personal; no hay demostración pública ni alta de clientes. Las cuentas nuevas requieren activación administrativa como Dueño o Cajero.

Se aprobaron 55 pruebas automáticas locales: 24 de base de datos y permisos, 14 de solicitudes, seis de lógica del POS y once de instalación/actualización y alta protegida de Cajero. También se verificaron la compilación y el rechazo de acceso sin sesión en producción. Estas pruebas no equivalen a una certificación de seguridad ni a la prueba de cinco a siete equipos.

Se preparó un instalador para el proyecto nuevo que reúne la base y el menú en una sola operación reversible ante errores. Se detiene si encuentra tablas o cuentas existentes, para reducir el riesgo de confundirlo con el otro proyecto del desarrollador. No se ha conectado, instalado ni modificado nada en ese otro proyecto.

La instalación ya se realizó en `los-chanchitos-desarrollo`, organización Los Chanchitos Free. La comprobación real confirmó 15 tablas con protección de acceso, 26 productos y una sucursal. Se cerró el registro público y se conectó la aplicación local con la llave publicable. Con el Dueño se probaron ingreso, búsqueda, cantidades, notas, guardado, recarga, cancelación, pedidos separados para llevar, efectivo, transferencia, pago combinado, recuperación de tickets y salida.

Se conservaron cuatro ventas de prueba por $100 QA y cinco pedidos cancelados, sin movimientos de dinero real. Se corrigió el conflicto de versiones y se verificó su protección en dos pestañas. El usuario creó una cuenta Cajero, autorizó su activación y entró personalmente; se comprobaron guardado, recuperación, comanda, bloqueo de cancelaciones, cobro simulado de $25 y recuperación del ticket 0009. No quedaron pedidos abiertos en esa auditoría. Las pruebas cruzadas con cuentas/navegadores independientes, carga y dispositivos físicos siguen pendientes; la revisión posterior de tamaños emulados se detalla abajo. Todavía no está listo para ventas reales. Ver `docs/CAJERO_2026-10-19.md`, `docs/CORRECCION_CONCURRENCIA_2026-10-19.md` y el informe inicial.

## Diseño web inicial

Se desarrolló una interfaz de colores provisionales, con un recuadro “Logo” para reemplazar después. Se priorizaron la legibilidad, el uso táctil y el lenguaje sencillo. La navegación incluye Punto de venta, Pedidos, Menú, Caja e Inventario. Caja e Inventario explican su alcance futuro, sin mostrar cifras ficticias.

Se verificaron ocho tamaños de pantalla en la compilación de producción local, sin desbordamiento horizontal del POS, y se corrigió un problema que ocultaba botones del pedido en celulares pequeños. No se registraron ventas durante esa revisión. La comprobación en dispositivos físicos y sesiones independientes todavía debe completarse.

El archivo `DISENO_INICIAL.md` incluye el recorrido de demostración y las limitaciones del avance. La revisión de tamaños y sus evidencias se documentan en `docs/RESPONSIVE_SESIONES_2026-10-19.md`.

## Información pendiente

Esta información no bloquea la entrega del avance, pero será necesaria para terminar el sistema:

- Ingredientes y cantidades aproximadas de cada producto.
- Existencias iniciales.
- Nombre exacto de los productos que aparecen sólo como “kilo”, “medio”, “cuarto” y “comida por litro”.
- Modelo y tamaño de papel de la impresora térmica.
- Datos que desean imprimir en el ticket.
- Nombres de los usuarios Dueño y Cajero.
- Reglas exactas para cancelaciones y cambios de precio.

## Tecnología

El sistema utiliza Next.js, React y TypeScript para la aplicación; Supabase y PostgreSQL para usuarios y datos; y está preparado para publicarse en Vercel.
