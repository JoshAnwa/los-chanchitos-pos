# Rediseño y autogestión · 26 de octubre de 2026

## Resultado

Se mantiene Next.js + React + TypeScript + Supabase. No se publicó, no se contrató alojamiento y no se cambió de proveedor.

El logo proporcionado se conserva sin retocar, en `public/logo.png` y como icono de la app. Paleta amarillo/rosa/azul, texto principal de 18–22 px, títulos de 25–38 px, controles de 48–72 px y navegación con etiquetas de 16–18 px. Se sustituyó el acceso provisional y se añadió Inicio con acciones directas.

El Dueño puede configurar productos, ingredientes, conteos, compras, recetas y datos del local desde la aplicación. El inventario no depende de que el desarrollador reciba recetas o existencias: el negocio las captura por sí mismo. Los productos pueden venderse sin control de inventario hasta habilitarlo individualmente.

## Operaciones de inventario

- Alta y edición de ingredientes, unidad fija, cantidad mínima y desactivación sin borrado.
- Conteo físico absoluto: reemplaza la existencia, exige motivo y registra la diferencia como movimiento.
- Compras con hasta 50 partidas, proveedor/folio/nota opcionales, total calculado en la base, existencias y costo promedio actualizados en una transacción. No realiza pagos ni retira efectivo de caja.
- Recetas por una venta y en la unidad del ingrediente, sin conversiones implícitas. Se usa la receta vigente al cobrar. Activar requiere ingredientes válidos y cantidades positivas.
- Descuento una sola vez al cobrar; faltante o ingrediente inactivo revierte cobro, ticket y todos los movimientos de esa transacción.
- Versiones para impedir que un conteo antiguo sobrescriba compras o ventas de otro equipo, más claves de solicitud para reintentos sin duplicados.
- Historial: últimos 100 movimientos y últimas 50 compras con sus partidas. No se elimina el historial desde la app.

Los formularios conservan el intento cuando no se confirma una respuesta. El cierre del formulario de inventario se confirma dentro de la propia app, con opción de seguir editando. La pérdida de red se avisa: no se ofrece venta offline ni persistencia local garantizada de borradores.

## Ventas y datos del local

Reporte por fechas inclusivas en America/Mexico_City: ventas cobradas, pedidos cobrados/cancelados, desglose por método, productos e importe de compras. No presenta una ganancia ficticia ni resta compras de caja. Periodo máximo: 366 días de diferencia.

El Dueño edita nombre/dirección de la sucursal para tickets. Las cuentas nuevas y contraseñas ajenas no se administran desde esta pantalla: requieren el procedimiento seguro de administración de usuarios. Los tickets no son facturas fiscales.

## Activación y conservación

Migración `202610260006_self_service_inventory.sql`, autorizada por el usuario y aplicada exclusivamente a `los-chanchitos-desarrollo` (`TU-REFERENCIA`). No se repitió el instalador ni el seed. La instalación nueva reúne seis migraciones; no se ejecuta sobre este proyecto existente.

Auditoría antes/después: productos, ingredientes, recetas, compras, sucursales, pedidos, pagos, caja, tickets y perfiles conservaron sus huellas. Se confirmaron los cuatro RPC nuevos y 17 tablas protegidas con RLS. Las llamadas anónimas a catálogo, pedidos, caja, menú, inventario, negocio, reportes y auditorías están bloqueadas. No hay contraseñas ni llaves secretas en estas pruebas.

## Pruebas ejecutadas

- **109 pruebas automáticas**: POS, pedidos, caja, menú, inventario, negocio, reportes, permisos, sucursales, validación, versiones, reintentos, timeout y actualización/instalación.
- TypeScript y compilación de producción correctos. Prueba de producción confirma redirección sin sesión y ausencia de demo pública. Integridad del instalador y verificación remota anónima correctas. No se ejecutó lint, al no solicitarse.
- Dueño real: alta de ingrediente vacío, conteos 0→2→0 con motivos, producto QA de $10, cambio a $12 con motivo obligatorio, receta de una pieza, rechazo del cobro sin stock, compra de una pieza a $5, cobro del mismo pedido y descuento de una pieza.
- Corte QA: fondo $0, esperado/contado $12, diferencia $0. Reporte del 26 de octubre: una venta QA por $12 y compra QA por $5. Los datos del local se guardaron, recargaron y restauraron a sus valores originales.
- Cajero real en sesión separada: catálogo de sólo consulta con 26 productos, sin edición ni navegación a módulos del Dueño. Caja cerrada impide cobrar. Los ataques de escritura directa y acceso entre sucursales están cubiertos por pruebas PostgreSQL locales; no se presentan como pruebas HTTP autenticadas de penetración.
- **42 combinaciones de distribución**: Inicio, Vender, Inventario, Ventas, Mi negocio, Productos y Caja en 1440×900, 1280×800, 1024×768, 768×1024, 390×844 y 320×740. Se comprobaron geometría y ausencia de desbordamiento de página; no equivale a dispositivos físicos ni certificación integral de accesibilidad.
- Celular: cantidades, bloqueo por caja cerrada, comanda digital y vaciado del borrador sin guardarlo. Escape en formulario muestra confirmación propia y «Seguir editando» conserva el texto; descartar cierra sin escribir en la base.

### Registros QA conservados

Prefijo **QA-20261026**. Pedido **0012**, pagado por $12, con un pago, un ticket y un descuento. Una compra de $5 y cuatro movimientos: +2, −2, +1, −1. Producto técnico e ingrediente desactivados; existencia final 0; receta apagada. Ninguno representa dinero real.

Los 26 productos, 11 pedidos, 7 pagos por $195 y el corte anteriores conservaron exactamente sus huellas. Totales de desarrollo al terminar: 12 pedidos (7 pagados y 5 cancelados), $207 en 8 partidas, 7 tickets y 2 cajas cerradas. No quedaron pedidos ni cajas abiertos. El inventario operativo queda vacío: el único ingrediente es QA e inactivo. No se borró ningún registro del servidor.

La copia local aislada `outputs/qa-preview-2026-10-26` no contiene `.env.local`, no se conecta a Supabase y su servidor está detenido. No es un entregable; se conserva porque la política del entorno impidió su limpieza automática. La fuente principal es `outputs/los-chanchitos-pos`.

## ¿Se puede publicar o vender?

**Código listo para preparar un piloto controlado, no entrega comercial definitiva certificada.** Antes de operar ventas reales:

1. Elegir alojamiento compatible con Next.js, dominio/HTTPS y las condiciones comerciales/costos del servicio. No se ha elegido ni contratado en esta etapa.
2. Preparar producción sin datos QA, con control del negocio, credenciales exclusivas y cuentas reales. No se deben borrar pruebas o ventas del proyecto actual sin autorización.
3. Definir y probar respaldo/restauración, recuperación de acceso y seguimiento de errores.
4. Probar carga de 5–7 usuarios en staging y conflictos reales de inventario en navegadores independientes. Dos roles y pruebas locales no certifican esa carga.
5. Configurar y probar la impresora real, tablet/PC y conexión del local; acordar qué hacer cuando no haya internet.
6. Aceptación del cliente con un turno completo y datos reales cargados por él; acordar soporte, alcance y entrega.

Una PWA en línea es una opción para instalación posterior; no está implementada ni certificada todavía. Requiere manifest, iconos adecuados, HTTPS y probar instalación en los dispositivos elegidos. Instalar no convierte la aplicación en un POS offline ni garantiza impresión silenciosa.

Fuentes consultadas: [lista de producción de Supabase](https://supabase.com/docs/guides/deployment/going-into-prod) y [requisitos de instalación PWA de MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
