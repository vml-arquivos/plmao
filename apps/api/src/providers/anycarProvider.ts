import { env } from '../config.js';
import { log } from '../lib/http.js';
import type { Piece } from '../report/layers.js';

/**
 * AnyCar — histórico de leilão simples por placa (POST /api/consultar, chave no cabeçalho x-api-key).
 * Devolve só se o veículo passou por leilão e os dados de cada passagem (data, leiloeiro, lote, condição, comitente, cidade/UF, valor).
 * O resultado entra no relatório como o bloco de leilão de sempre, então tela, PDF e API não mudam.
 */
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (v == null || isRec(v) || Array.isArray(v) ? '' : String(v).trim());
const fail = (code: string, detail?: string): Error => Object.assign(new Error(detail ?? code), { code, detail });

/** dataLeilao → DATA_LEILAO, cidadeUF → CIDADE_UF. */
export function upperSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

const NOT_FOUND_TEXT = /nao (foi )?(encontrad|localizad|consta|possui|ha)|sem (registro|leilao|historico)|nenhum/;
const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lista de passagens por leilão dentro de `dados` (lista direta, ou em leiloes/historico/registros/items). */
export function auctionRows(dados: unknown, depth = 0): Rec[] {
  if (depth > 3) return [];
  if (Array.isArray(dados)) return dados.filter(isRec);
  if (!isRec(dados)) return [];
  for (const k of ['leiloes', 'historico', 'historicoLeiloes', 'registros', 'items', 'itens', 'resultado', 'lista']) {
    const v = dados[k];
    if (Array.isArray(v)) return v.filter(isRec);
    if (isRec(v)) { const inner = auctionRows(v, depth + 1); if (inner.length) return inner; }
  }
  // Um único registro com os campos direto em `dados`.
  const hasFields = Object.entries(dados).some(([k, v]) => /leilao|leiloeiro|lote|arremate|comitente/i.test(k) && text(v) !== '');
  return hasFields ? [dados] : [];
}

/** Converte a resposta da AnyCar no bloco de leilão do relatório: REGISTRO_n com campos em MAIÚSCULAS. */
export function toAuctionPiece(body: unknown): Piece {
  if (!isRec(body)) throw fail('DATA_PROVIDER_INVALID_RESPONSE', 'AnyCar devolveu uma resposta que não é JSON.');
  const rows = auctionRows(body.dados);
  if (rows.length) {
    const resposta: Rec = { DESCRICAORETORNO: 'CONSTA REGISTRO DE LEILAO' };
    rows.slice(0, 30).forEach((r, i) => {
      const rec: Rec = {};
      for (const [k, v] of Object.entries(r)) if (!isRec(v) && !Array.isArray(v) && text(v) !== '') rec[upperSnake(k)] = text(v);
      resposta[`REGISTRO_${i + 1}`] = rec;
    });
    return { kind: 'data', resposta };
  }
  const message = fold([text(body.mensagem), text(body.message), text(body.erro), isRec(body.dados) ? text(body.dados.mensagem) : text(body.dados)].join(' '));
  if (body.status === true || NOT_FOUND_TEXT.test(message)) return { kind: 'notFound' };
  throw fail('DATA_PROVIDER_INVALID_RESPONSE', `AnyCar não confirmou a consulta${message ? `: ${message.slice(0, 120)}` : ''}.`);
}

export interface AnycarOptions { apiKey?: string; baseUrl?: string; type?: string; timeoutMs?: number; fetchImpl?: typeof fetch }

/** Consulta o histórico de leilão. "Não encontrado" é resultado válido (nada consta); falhas são lançadas com código. */
export async function queryAnycarAuction(plate: string, o: AnycarOptions = {}): Promise<Piece> {
  const apiKey = (o.apiKey ?? env.ANYCAR_API_KEY ?? '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!apiKey) throw fail('DATA_PROVIDER_NOT_CONFIGURED', 'Falta ANYCAR_API_KEY para a fonte de leilão simples.');
  const base = (o.baseUrl ?? env.ANYCAR_BASE_URL ?? 'https://anycar.com.br').replace(/\/$/, '');
  const type = o.type ?? env.ANYCAR_AUCTION_TYPE;
  const timeoutMs = o.timeoutMs ?? env.ANYCAR_TIMEOUT_MS;
  const started = Date.now();
  let response: Response;
  try {
    response = await (o.fetchImpl ?? fetch)(`${base}/api/consultar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ tipo: type, placa: plate.toUpperCase() }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    log('warn', 'anycar_call_failed', { ms: Date.now() - started, kind: e instanceof Error ? e.name : 'erro' });
    throw fail('PROVIDER_TIMEOUT', `Sem resposta da AnyCar após ${Math.round((Date.now() - started) / 1000)} s.`);
  }
  log('info', 'anycar_call', { status: response.status, ms: Date.now() - started });
  if (response.status === 401 || response.status === 403) throw fail('DATA_PROVIDER_AUTH_FAILED', 'AnyCar recusou a chave (ANYCAR_API_KEY).');
  if (response.status === 402) throw fail('DATA_PROVIDER_QUOTA_EXHAUSTED', 'AnyCar sem saldo.');
  if (response.status === 429) throw fail('DATA_PROVIDER_RATE_LIMITED', 'AnyCar limitou as chamadas.');
  if (response.status === 404) return { kind: 'notFound' };
  if (response.status >= 500) throw fail('DATA_PROVIDER_UNAVAILABLE', `AnyCar indisponível (HTTP ${response.status}).`);
  const body = await response.json().catch(() => null);
  if (!response.ok && !isRec(body)) throw fail('DATA_PROVIDER_INVALID_RESPONSE', `AnyCar respondeu HTTP ${response.status}.`);
  return toAuctionPiece(body);
}
