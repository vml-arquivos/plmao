export const BRAND = {
  name: 'Placa na Mão',
  descriptor: 'Consulta veicular completa',
  slogan: 'Seu veículo em boas mãos.',
  supportEmail: String(import.meta.env.VITE_SUPPORT_EMAIL || 'contato@placanamao.com.br').trim()
} as const;
