# Backup e restauração do banco

**Regra:** antes de cada deploy que mexe em banco (migração) e todo dia, tenha uma cópia que já foi testada em restauração.

## Opção 1 — Coolify (recomendada)
No Coolify: banco PostgreSQL → **Backups** → agendar diário, retenção de pelo menos 14 dias, destino **S3/Spaces** (fora da droplet). Rode "Backup agora" uma vez e confira que o arquivo apareceu no destino.

## Opção 2 — script do repositório
Em um computador/servidor com `pg_dump` instalado:

```
DATABASE_URL="postgresql://..." ./scripts/backup-db.sh ./backups
```

Gera `placanamao-AAAAMMDD-HHMMSS.dump`, confere que o arquivo abre e guarda os últimos 14.

## Ensaio de restauração (faça uma vez antes do lançamento)
1. Crie um banco vazio de teste (nunca restaure por cima da produção).
2. `TARGET_DATABASE_URL="postgresql://.../teste" ./scripts/restore-db.sh placanamao-....dump`
3. Confira que o número de migrações e de usuários bate com a produção.
4. Anote o tempo que levou: esse é o seu tempo de recuperação.

## Antes de migração
Faça "Backup agora" no Coolify, anote o horário e só então publique. Se algo der errado, volte a imagem anterior; não use `db:rollback` para desfazer conteúdo.

## Prontidão do deploy
`GET /ready` responde 200 só quando **todas** as migrações esperadas estão aplicadas (503 e a lista das que faltam caso contrário). `GET /health` só diz que o processo está vivo.
