import { env } from '../config.js';
import type { VehicleDataProvider } from '../types.js';

/**
 * Adaptador da ConsultarPlaca (API v2, docs.consultarplaca.com.br), pensado para testar o sistema.
 *  - GET {base}/v2/consultarPlaca?placa=AAA0000 com Basic Auth (e-mail + chave da API);
 *  - a resposta é convertida para o envelope CONSULTA/RESPOSTA.VEICULOSBDRP que o normalizador já entende;
 *  - só entram os campos que a fonte devolveu. Débitos e restrições não vêm nessa consulta e, por isso,
 *    ficam como "não fornecido" no relatório (nunca "nada consta").
 * A placa AAA0000 é a placa de teste da fonte: devolve dados fictícios e não consome crédito.
 */
type Failure = Error & { code: string };
const fail = (code: string): Failure => Object.assign(new Error(code), { code });

export interface ConsultarPlacaOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string; email?: string; apiKey?: string; timeoutMs?: number;
}

const text = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t ? t : undefined;
};

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {});

/** Converte a resposta da ConsultarPlaca para o formato interno. Exportada para teste. */
export function toBdrpEnvelope(plate: string, body: unknown, requestedAt = new Date()): Obj {
  const info = obj(obj(obj(body).dados).informacoes_veiculo);
  const v = obj(info.dados_veiculo);
  const t = obj(info.dados_tecnicos);
  const c = obj(info.dados_carga);
  const full = text(v.modelo);
  const slash = full?.indexOf('/') ?? -1;
  const retorno: Record<string, string> = {};
  const put = (key: string, value: unknown) => { const s = text(value); if (s) retorno[key] = s; };
  put('PLACA', text(v.placa) ?? plate);
  put('CHASSI', v.chassi);
  put('MARCA', v.marca);
  put('MARCAMODELOCOMPLETO', full);
  put('MODELO', full && slash >= 0 ? full.slice(slash + 1) : full);
  put('VEIANOFABR', v.ano_fabricacao);
  put('VEIANOMODELO', v.ano_modelo);
  put('COR', v.cor);
  put('VEICATEGORIA', v.segmento);
  put('ESPECIE', v.especie);
  put('COMBUSTIVEL', v.combustivel);
  put('VEIPROCEDENCIA', v.procedencia);
  put('MUNICIPIO', v.municipio);
  put('UF', v.uf_municipio);
  put('TIPO', t.tipo_veiculo);
  put('MOTOR', t.numero_motor);
  put('NUMERO_CAIXACAMBIO', t.numero_caixa_cambio);
  put('POTENCIA', t.potencia);
  put('CILINDRADA', t.cilindradas);
  put('EIXOS', c.numero_eixos);
  put('CAPACIDADEPASSAG', c.capacidade_passageiro);
  retorno.EXISTE_ERRO = '0';
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = requestedAt;
  return {
    CONSULTA: { DATAHORA: `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` },
    RESPOSTA: { CODIGO: '1', VEICULOSBDRP: { DESCRICAORETORNO: 'SUCESSO', RETORNO: retorno } }
  };
}

export class ConsultarPlacaVehicleProvider implements VehicleDataProvider {
  readonly name = 'consultarplaca';
  private readonly o: ConsultarPlacaOptions;
  constructor(options: ConsultarPlacaOptions = {}) { this.o = options; }

  async queryByPlate(plate: string): Promise<{ providerQueryId?: string; raw: unknown }> {
    const baseUrl = (this.o.baseUrl ?? env.CONSULTARPLACA_BASE_URL ?? 'https://api.consultarplaca.com.br').replace(/\/$/, '');
    const email = this.o.email ?? env.CONSULTARPLACA_EMAIL;
    const apiKey = this.o.apiKey ?? env.CONSULTARPLACA_API_KEY;
    if (!email || !apiKey) throw fail('DATA_PROVIDER_NOT_CONFIGURED');

    let response: Response;
    try {
      response = await (this.o.fetchImpl ?? fetch)(`${baseUrl}/v2/consultarPlaca?placa=${encodeURIComponent(plate)}`, {
        method: 'GET',
        headers: { accept: 'application/json', authorization: `Basic ${Buffer.from(`${email}:${apiKey}`).toString('base64')}` },
        signal: AbortSignal.timeout(this.o.timeoutMs ?? env.VEHICLE_API_TIMEOUT_MS)
      });
    } catch { throw fail('PROVIDER_TIMEOUT'); }

    const body = await response.json().catch(() => null) as Obj | null;
    const kind = text(body?.tipo_do_erro);
    if (response.status === 401 || response.status === 403) throw fail('DATA_PROVIDER_AUTH_FAILED');
    if (response.status === 402 || kind === 'credito_insuficiente') throw fail('DATA_PROVIDER_QUOTA_EXHAUSTED');
    if (response.status === 429) throw fail('DATA_PROVIDER_RATE_LIMITED');
    if (kind === 'placa_nao_encontrada' || kind === 'informacao_nao_encontrada') throw fail('NOT_FOUND');
    if (kind === 'servico_indisponivel' || response.status >= 500) throw fail('DATA_PROVIDER_UNAVAILABLE');
    if (!response.ok || !body || body.status !== 'ok') throw fail('DATA_PROVIDER_INVALID_RESPONSE');
    if (!Object.keys(obj(obj(obj(body.dados).informacoes_veiculo).dados_veiculo)).length) throw fail('DATA_PROVIDER_INVALID_RESPONSE');
    return { raw: { placa: plate, data: toBdrpEnvelope(plate, body) } };
  }
}
