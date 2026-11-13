# Los Chanchitos · Diseño web inicial

18 de octubre de 2026

## Dirección visual

Interfaz clara, fondo neutro, color verde provisional para las acciones principales, texto directo e iconos sencillos. El recuadro “Logo” es un espacio temporal que se reemplazará cuando el negocio tenga su archivo definitivo. No se desarrolló una identidad gráfica.

## Pantallas del avance

- **Acceso:** correo y contraseña, o entrada a la demostración sin cuenta.
- **Punto de venta:** cinco mesas independientes y un pedido para llevar; 26 opciones del menú recibido, búsqueda y categorías; cantidades, notas, total y vaciado con confirmación.
- **Comanda:** vista previa de los productos y la nota para cocina; impresión mediante el navegador.
- **Cobro:** elección del método, monto recibido y cambio en efectivo; pago combinado con cantidades elegidas por quien cobra; confirmación antes de finalizar.
- **Ticket:** detalle del pedido y desglose del pago, con opción de impresión.
- **Pedidos:** dos estados visibles, Pedido y Pagado. En demostración se muestran los pedidos guardados y pagados durante la sesión.
- **Menú:** consulta de los productos y precios recibidos.
- **Caja e inventario:** espacios explicativos de la siguiente etapa, sin saldos ni existencias ficticias.

## Recorrido para presentar

1. Abrir `/pos` y pulsar **Probar con un ejemplo**. Se agregan dos tacos, un pozole y un agua de litro: total **$160**.
2. Cambiar a Mesa 2 y agregar una cemita. Volver a Mesa 1 para mostrar que cada mesa conserva su pedido.
3. Abrir **Nota para cocina**, escribir una indicación y pulsar **Ver comanda**.
4. Guardar el pedido de prueba y abrir **Pedidos** para consultarlo.
5. Abrir el pedido, pulsar **Cobrar** y simular un pago. Con $200 en efectivo el cambio es $40; en combinado se puede registrar $60 en efectivo y $100 en tarjeta.
6. Mostrar el ticket y la pestaña **Pagados**. Recorrer **Menú**, **Caja** e **Inventario** para explicar el alcance.

## Qué significa la demostración

Los pedidos de prueba viven sólo en la página abierta: recargar reinicia la sesión. No se realiza ningún cargo ni se registra una venta real. La comanda no se envía automáticamente a una impresora o pantalla remota: se presenta una vista imprimible.

La conexión existente con Supabase se conserva para el acceso y el registro transaccional del cobro cuando se configure un proyecto real. La conexión remota, las políticas de acceso y el descuento de inventario aún requieren pruebas con ese proyecto. No se verificó una impresora física ni cinco a siete usuarios simultáneos.

## Comprobación del diseño

Se revisaron las pantallas en computadora, tablet horizontal y celular, además de navegación, separación de mesas, comanda, cobro, pago combinado y búsqueda. La aplicación pasa la compilación de producción y la revisión de código.
