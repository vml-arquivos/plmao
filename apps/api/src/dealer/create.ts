import { tx } from '../db.js';
import { env } from '../config.js';
import { conflict, slugify, storeFromRow, type DealerStore } from './context.js';

export interface NewStore { name: string; slug?: string; whatsapp?: string | null; email?: string | null; city?: string | null; state?: string | null }

/** Cria a loja e o vínculo de dono na mesma transação. Uma pessoa só pode ter uma loja. Sem slug informado, gera pelo nome. */
export async function createDealership(ownerUserId: string, b: NewStore): Promise<DealerStore> {
  const row = await tx(async (client) => {
    const member = await client.query('SELECT 1 FROM dealership_members WHERE user_id=$1 AND active', [ownerUserId]);
    const owned = await client.query('SELECT 1 FROM dealerships WHERE owner_user_id=$1', [ownerUserId]);
    if (member.rowCount || owned.rowCount) throw conflict('Esta pessoa já participa de uma loja.', 'DEALER_ALREADY_MEMBER');
    const base = b.slug ?? slugify(b.name);
    for (let attempt = 0; attempt < 6; attempt++) {
      const slug = attempt === 0 ? base : `${base.slice(0, 33)}-${Math.random().toString(36).slice(2, 6)}`;
      const exists = await client.query('SELECT 1 FROM dealerships WHERE lower(slug)=$1', [slug]);
      if (exists.rowCount) { if (b.slug && attempt === 0) throw conflict('Este endereço já está em uso. Escolha outro.', 'DEALER_SLUG_TAKEN'); continue; }
      const ins = await client.query(`INSERT INTO dealerships(owner_user_id,name,slug,whatsapp,email,city,state,vehicle_limit,member_limit) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ownerUserId, b.name, slug, b.whatsapp ?? null, b.email ?? null, b.city || null, b.state ?? null, env.DEALER_DEFAULT_VEHICLE_LIMIT, env.DEALER_DEFAULT_MEMBER_LIMIT]);
      await client.query(`INSERT INTO dealership_members(dealership_id,user_id,role) VALUES($1,$2,'OWNER')`, [ins.rows[0].id, ownerUserId]);
      return ins.rows[0] as Record<string, unknown>;
    }
    throw conflict('Não foi possível reservar um endereço para a loja. Tente outro nome.', 'DEALER_SLUG_TAKEN');
  });
  return storeFromRow(row);
}
