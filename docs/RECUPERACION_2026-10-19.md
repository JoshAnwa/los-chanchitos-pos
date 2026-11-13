# Recuperación de solicitudes · 19 de octubre de 2026

Seguimiento posterior: se identificó el uso incorrecto de SQLSTATE `40001` y se aplicó la migración 003 con `PT409`. Este informe conserva lo observado durante la mitigación inicial; consulta [la corrección de la causa](CORRECCION_CONCURRENCIA_2026-10-19.md) para el estado más reciente.

## Resultado y alcance

Se añadió un límite de 15 segundos a las cuatro operaciones del POS: consultar, guardar, cobrar y cancelar. Ante falta de respuesta se aborta la petición, se conserva el borrador en pantalla y se devuelve el control al personal con una advertencia. Una respuesta tardía ya no se aplica a la interfaz. No hay reenvío automático añadido.

El límite cubre también la espera de sesión previa al HTTP y la lectura del cuerpo de respuesta, no sólo la conexión. El cliente sigue usando Supabase Auth y los mismos RPC protegidos por RLS. No se cambiaron permisos, esquema, credenciales, dependencias ni servicios contratados.

**Esto es una mitigación comprobada, no una resolución de la causa original.** La segunda pestaña automatizada volvió a esperar sin recibir la respuesta de conflicto. Ahora mostró el aviso y habilitó los controles. No está confirmado si el bloqueo de origen corresponde al SDK, la red o el entorno de automatización. La consola observada no aportó errores. No se deshabilitaron mecanismos de sesión ni se modificaron librerías para atribuir una causa sin evidencia.

El aviso de error de venta se ubicó dentro del panel del pedido para evitar que el margen negativo del panel lo tapara. El panel permite desplazamiento cuando aparece el aviso, para mantener alcanzables las acciones en pantallas bajas. Las ventanas de cobro, cancelación y comanda conservan sus mensajes propios.

## Pruebas locales

49 pruebas automáticas aprobadas: 35 existentes y 14 nuevas de solicitudes. Se usa el módulo TypeScript real y el SDK instalado con transporte y sesión simulados; no se envían esas pruebas a Supabase. Los límites se aceleran sólo en pruebas, y otro caso comprueba los 15 segundos predeterminados con reloj controlado.

Casos nuevos: respuesta normal, límite predeterminado, espera infinita, respuesta tardía ignorada, excepción síncrona, aborto que rechaza, parámetros y señales de los cuatro RPC, conflicto `ORDER_CHANGED` sin reintento, bloqueo de las cuatro operaciones, bloqueo previo al HTTP, cuerpo HTTP sin respuesta, petición posterior independiente y reintento con el mismo identificador. Las pruebas SQL existentes siguen comprobando que los reintentos no duplican cobros.

La compilación de producción, ESLint y la prueba de acceso sin sesión fueron satisfactorios. El instalador sigue coincidiendo con las migraciones y no se volvió a aplicar a la nube.

## Comprobación visible con el Dueño

El usuario inició sesión personalmente; no se leyó ni se solicitó su contraseña.

1. Se guardó el pedido **0006**, Mesa 1, un Tacos por **$25**, marcado `QA-20261019`.
2. Se abrió una segunda pestaña con la versión inicial.
3. La primera guardó la nota `QA-20261019 · versión A · sin venta real`.
4. La segunda cambió la cantidad a dos ($50) e intentó guardar. Recibió el aviso de espera y recuperó los controles conservando las dos unidades en pantalla.
5. Al recargar la primera, seguían guardados una unidad, $25 y la nota de A: no hubo sobrescritura.
6. Se canceló 0006 desde la primera, motivo `Prueba técnica QA-20261019; sin venta real`.

Después del ajuste visual se repitió con **0007**, también un Tacos por $25. El primer guardado desde la pestaña nueva sí terminó. La versión antigua volvió a agotar la espera al intentar sobrescribir una nota más reciente. Se comprobó visualmente el mensaje completo dentro del pedido, controles habilitados, y desplazamiento del panel (607 px visibles y 800 px de contenido). La versión más reciente se conservó y 0007 se canceló con motivo `Prueba técnica QA-20261019; segundo intento sin venta real`.

La consulta exclusivamente de lectura `supabase/verify_qa_recovery.sql` confirmó **dos pedidos, 0006 y 0007, ambos cancelados, versión 3, total $25 cada uno, notas de A, cero pedidos QA nuevos abiertos y cero pagos**. No se eliminaron los registros ni se cobró dinero. Los registros QA del 18 de octubre se conservaron sin cambios.

Evidencias en la carpeta superior `outputs`: `qa-aviso-en-pedido-20261019.jpg` (resultado visual final) y `qa-auditoria-recuperacion-20261019.jpg` (auditoría de los dos pedidos cancelados). `qa-recuperacion-20261019.jpg` es la captura inicial que permitió detectar el aviso parcialmente tapado; no debe usarse como evidencia del ajuste visual posterior.

## Pendientes

- Identificar la causa de la falta de respuesta y repetir en dos navegadores/equipos reales, no sólo pestañas automatizadas del mismo entorno.
- Probar un Cajero real y cinco a siete usuarios; todavía no se certifica concurrencia para operación comercial.
- Repetir móvil/tablet con tamaños verificables, impresión física y recuperación completa tras pérdida de conexión.
- La espera vencida **no significa que el servidor cancelara o revirtiera la operación**. Consultar los pedidos antes de iniciar otro cobro si existe duda. Los identificadores de reintento se mantienen durante la sesión de la página; una recarga no equivale a repetir con el mismo identificador.

Al terminar se cerró la sesión del POS y se detuvieron tanto el servidor de desarrollo como el temporal de producción. Para retomar: `npm run dev` e ingreso personal. No se borraron los pedidos de auditoría.

La guía de Sites se usó en modalidad local: sin publicación ni contratación de servicios. Esta entrega no declara el sistema listo para ventas reales.
