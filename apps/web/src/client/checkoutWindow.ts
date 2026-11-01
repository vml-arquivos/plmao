/**
 * Pix e cartão abrem em outra aba. A aba original fica na tela "Confirmando seu pagamento", que confere o pedido sozinha
 * e continua a consulta assim que o pagamento é aprovado; a aba do Mercado Pago é fechada ao concluir.
 * Se o navegador bloquear a nova aba, o pagamento abre na mesma aba, como antes.
 */
let handle: Window | null = null;

/** Precisa ser chamada direto no clique (antes de qualquer espera), senão o navegador bloqueia a aba. */
export function reserveCheckoutWindow(): Window | null {
  try {
    handle = window.open('about:blank', '_blank');
    if (handle) handle.document.write('<title>Pagamento</title><p style="font-family:sans-serif;padding:24px">Abrindo o pagamento…</p>');
  } catch { /* sem aba extra */ }
  return handle;
}

export function sendCheckoutWindow(url: string): boolean {
  try {
    if (handle && !handle.closed) { handle.location.href = url; return true; }
  } catch { /* segue para a mesma aba */ }
  return false;
}

export function checkoutWindowOpen(): boolean {
  try { return Boolean(handle && !handle.closed); } catch { return false; }
}

export function closeCheckoutWindow(): void {
  try { if (handle && !handle.closed) handle.close(); } catch { /* ignora */ }
  handle = null;
}
