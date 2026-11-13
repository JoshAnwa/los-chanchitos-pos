export const ORDER_REQUEST_TIMEOUT_MS = 15_000;
export const ORDER_REQUEST_TIMEOUT_MESSAGE = "La operación tardó demasiado y no pudimos confirmar el resultado. Tu pedido sigue en pantalla. Revisa la conexión y reintenta sin cambiarlo, o consulta Actualizar pedidos antes de volver a cobrar. No tomes esta espera como una cancelación.";

// El límite incluye la obtención de sesión del SDK, no sólo la conexión HTTP.
// Abortar una petición no garantiza que PostgreSQL no la haya confirmado.
export async function runOrderRequest<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = ORDER_REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Rechazar primero evita que el error de aborto del SDK oculte este aviso.
      reject(new Error(ORDER_REQUEST_TIMEOUT_MESSAGE));
      controller.abort();
    }, timeoutMs);
  });
  try {
    // Promise.resolve también cubre los builders diferidos (PromiseLike) del SDK.
    // Una respuesta tardía queda consumida, pero no llega al estado de la interfaz.
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
