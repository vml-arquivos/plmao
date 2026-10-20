import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { env } from './config.js';
import { runMigrations } from './migrations.js';

export async function ensureSchema() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      password_hash text NOT NULL,
      name text NOT NULL,
      role text NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','OPERADOR','CLIENTE')),
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS wallets (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS query_products (
      id text PRIMARY KEY,
      name text NOT NULL,
      description text NOT NULL,
      credit_cost integer NOT NULL CHECK (credit_cost >= 0),
      active boolean NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS vehicle_queries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      plate text NOT NULL,
      product_id text NOT NULL REFERENCES query_products(id),
      status text NOT NULL CHECK (status IN ('PROCESSING','SUCCESS','FAILED','REFUNDED')),
      credits_cost integer NOT NULL,
      provider text NOT NULL,
      provider_query_id text,
      error_code text,
      error_message text,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      kind text NOT NULL CHECK (kind IN ('PURCHASE','QUERY','REFUND','ADMIN_ADJUSTMENT')),
      amount integer NOT NULL,
      balance_before integer NOT NULL,
      balance_after integer NOT NULL CHECK (balance_after >= 0),
      query_id uuid REFERENCES vehicle_queries(id),
      payment_id uuid,
      description text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS vehicle_query_results (
      query_id uuid PRIMARY KEY REFERENCES vehicle_queries(id) ON DELETE CASCADE,
      normalized jsonb NOT NULL,
      raw_response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sandbox_vehicles (
      plate text PRIMARY KEY,
      raw_response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS payments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      provider text NOT NULL,
      status text NOT NULL CHECK (status IN ('PENDING','PAID','CANCELLED','FAILED')),
      amount_cents integer NOT NULL,
      credits integer NOT NULL,
      external_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      paid_at timestamptz
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      cpf_cnpj text,
      phone text,
      company_name text,
      city text,
      state char(2),
      marketing_opt_in boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      document text,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS organization_members (
      organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role text NOT NULL DEFAULT 'MEMBER',
      PRIMARY KEY (organization_id,user_id)
    );

    CREATE TABLE IF NOT EXISTS data_providers (
      id text PRIMARY KEY,
      name text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      priority integer NOT NULL DEFAULT 100,
      config jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS saved_vehicles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plate text NOT NULL,
      nickname text,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(user_id,plate)
    );

    CREATE TABLE IF NOT EXISTS query_exports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      query_id uuid NOT NULL REFERENCES vehicle_queries(id) ON DELETE CASCADE,
      format text NOT NULL CHECK(format IN ('PDF','JSON')),
      storage_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id bigserial PRIMARY KEY,
      user_id uuid REFERENCES users(id),
      action text NOT NULL,
      entity text NOT NULL,
      entity_id text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vehicle_queries_user_created ON vehicle_queries(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_vehicle_queries_plate ON vehicle_queries(plate);
    CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_created ON wallet_transactions(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created ON audit_logs(user_id,created_at DESC);
  `);

  const products = [
    ['BASIC','Consulta Básica','Identificação e características principais do veículo',5,500],
    ['DEBTS','Débitos e Restrições','Débitos, multas e principais restrições',8,800],
    ['COMPLETE','Consulta Completa','Identificação, características, débitos, restrições e situação',12,1200],
    ['PREMIUM','Consulta Premium','Todos os campos disponíveis no provedor',18,1800]
  ];
  for (const p of products) {
    await pool.query(`INSERT INTO query_products(id,name,description,credit_cost) VALUES($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, credit_cost=EXCLUDED.credit_cost`, p.slice(0, 4));
  }

  await runMigrations();

  if (env.SUPER_ADMIN_BOOTSTRAP_ENABLED) {
    if (!env.SUPER_ADMIN_BOOTSTRAP_EMAIL) throw new Error('SUPER_ADMIN_BOOTSTRAP_EMAIL_REQUIRED');
    const promoted = await pool.query(`UPDATE users
      SET role='SUPER_ADMIN', active=true
      WHERE lower(email)=lower($1) AND deleted_at IS NULL
      RETURNING id,email,name,role`, [env.SUPER_ADMIN_BOOTSTRAP_EMAIL]);
    if (!promoted.rowCount) throw new Error('SUPER_ADMIN_BOOTSTRAP_USER_NOT_FOUND');
    await pool.query(`INSERT INTO audit_logs(user_id,action,entity,entity_id,metadata)
      VALUES($1::uuid,'BOOTSTRAP_SUPER_ADMIN','USER',$2::text,$3::jsonb)`, [promoted.rows[0].id, promoted.rows[0].id, JSON.stringify({ email: promoted.rows[0].email, source: 'production_bootstrap' })]);
  }

  for (const p of products) {
    await pool.query(`INSERT INTO query_products(id,name,description,credit_cost,price_cents) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, credit_cost=EXCLUDED.credit_cost, price_cents=EXCLUDED.price_cents`, p);
  }

  if (!env.SANDBOX_SEED_ENABLED) return;

  const users = [
    ['admin@demo.local','Admin Sandbox','SUPER_ADMIN','Admin@123456',250],
    ['cliente@demo.local','Cliente Demonstração','CLIENTE','Demo@123456',100]
  ] as const;
  for (const [email,name,role,password,balance] of users) {
    const hash = await bcrypt.hash(password, 12);
    const res = await pool.query(`INSERT INTO users(email,password_hash,name,role) VALUES($1,$2,$3,$4)
      ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [email,hash,name,role]);
    await pool.query(`INSERT INTO wallets(user_id,balance,balance_cents) VALUES($1,0,$2) ON CONFLICT(user_id) DO NOTHING`, [res.rows[0].id,balance * 100]);
  }

  const samples = [
    vehicle('TST0A00','NOVA MOTORS','ECO X','2022','2023','PRATA','FLEX','GOIANIA','GO',0,0,false),
    vehicle('DEV1B11','ALFA AUTO','URBAN 1.6','2019','2020','BRANCO','GASOLINA','BRASILIA','DF',29347,16022,true),
    vehicle('MOCK2C22','BETA VEICULOS','TRAIL 2.0','2024','2025','PRETO','DIESEL','PALMAS','TO',0,0,false),
    vehicle('IPV2A22','GAMA AUTOMOVEIS','CITY 1.5','2021','2022','CINZA','FLEX','CURITIBA','PR',0,0,false,182500),
    vehicle('REN3J33','DELTA MOTORS','ROAD 2.0','2020','2021','AZUL','DIESEL','SAO PAULO','SP',0,0,true,0,true),
    vehicle('REC4L44','EPSILON AUTO','HATCH S','2023','2024','VERMELHO','FLEX','BELO HORIZONTE','MG',0,0,false,0,false,true),
    vehicle('FUR5T55','ZETA MOTORS','CROSS 1.0','2018','2019','PRETO','GASOLINA','RIO DE JANEIRO','RJ',0,0,false,0,false,false,true),
    vehicle('MUL6T66','OMEGA AUTO','SEDAN LX','2022','2023','BRANCO','FLEX','VITORIA','ES',45900,0,false),
    vehicle('INC7P77','NOVA MOTORS','ESSENTIAL','2017','2018','PRATA','FLEX','RECIFE','PE',0,0,false,0,false,false,false,true)
  ];
  for (const v of samples) {
    await pool.query(`INSERT INTO sandbox_vehicles(plate,raw_response) VALUES($1,$2::jsonb) ON CONFLICT(plate) DO UPDATE SET raw_response=EXCLUDED.raw_response`, [v.CONSULTA_PLACA, JSON.stringify(v.PAYLOAD)]);
  }
}

function vehicle(plate:string, brand:string, model:string, fabr:string, modelYear:string, color:string, fuel:string, city:string, uf:string, fineCents:number, licCents:number, judicial:boolean, ipvaCents=0, financial=false, recall=false, stolen=false, incomplete=false) {
  const money=(c:number)=>(c/100).toFixed(2).replace('.',',');
  const r={
    CAPACIDADECARGA:'450', CAPACIDADEPASSAG:'5', CARROCERIA:'NAO APLICAVEL', CCOMUNICACAOVENDA:'NAO CONSTA COMUNICACAO DE VENDAS',
    CHASSI:'9ZZSANDBOX'+plate.replace(/[^A-Z0-9]/g,'').padEnd(7,'0'), CILINDRADA:'1598', CMT:'0', COMBUSTIVEL:fuel, COR:color,
    CPF_CNPJ_PROPRIETARIO:'***.***.000-**', DATAEMISSAOCRV:'15/03/2023', DEBCETESB:'0,00', DEBDER: money(fineCents), DEBDERSA:'0,00', DEBDETRAN:'0,00', DEBIPVA:money(ipvaCents), DEBMUNICIPAIS:'0,00', DEBPOLRODFED:'0,00', DEBRENAINF:'0,00', DPVAT:'0,00',
    EIXOS:'2', ESPECIE:'PASSAGEIRO', EXISTEDEBITODEDPVAT:'NAO EXISTE DEBITO DE DPVAT', EXISTEDEBITODEIPVA:'NAO EXISTE DEBITO DE IPVA',
    EXISTEDEBITODELICENCIAMENTO: licCents>0?'EXISTE DEBITO DE LICENCIAMENTO':'NAO EXISTE DEBITO DE LICENCIAMENTO', EXISTEDEBITODELICENCIAMENTOVL: money(licCents),
    EXISTEDEBITOMULTA: fineCents>0?'EXISTE DEBITO DE MULTA':'NAO EXISTE DEBITO DE MULTA', EXISTE_ERRO:'0', LICDATA:'10/09/2025', LICEXELIC:'2025',
    MARCA:brand, MARCAMODELOCOMPLETO:`${brand}/${model}`, MODELO:model, MOTOR:'MOTOR-SANDBOX-001', MUNICIPIO:city, NUMERO_CAIXACAMBIO:'CAMBIO-SANDBOX-001',
    OUTRAS_RESTRICOES_01:'NADA CONSTA', OUTRAS_RESTRICOES_02:'NADA CONSTA', OUTRAS_RESTRICOES_03:'NADA CONSTA', OUTRAS_RESTRICOES_04:'NADA CONSTA', PBT:'1650', PLACA:plate,
    POTENCIA:incomplete?'':'120', PRONOME:'PROPRIETARIO FICTICIO SANDBOX', PRONOMEANTERIOR:'', RECALL:recall?'RECALL FICTICIO PENDENTE PARA TESTE':'NAO POSSUI RECALL', REDUNDANCIA:'ORIGINAL', RENAVAM:'00000000000',
    RESADMINISTRATIVA:'NADA CONSTA', RESAMBIENTAL:'VEICULO COM INSPECAO VEICULAR OK', RESFURTO:stolen?'REGISTRO FICTICIO DE FURTO/ROUBO PARA TESTE':'NADA CONSTA', RESGUINCHO:'NADA CONSTA',
    RESJUDICIAL:judicial?'RESTRICAO JUDICIAL FICTICIA PARA TESTE':'NADA CONSTA', RESRENAJUD:judicial?'CONSTA RESTRICAO FICTICIA':'NADA CONSTA', RESTRIBUTARIA:'NADA CONSTA', RESTRICAOFINAN:financial?'GRAVAME FICTICIO PARA TESTE':'NADA CONSTA', RESTRICAORFB:'NAO POSSUI RESTRICAO RFB',
    SITUACAOVEICULO:'CIRCULACAO', TEMPOEXECUCAO:'1', TIPO:'AUTOMOVEL', TIPODOCUMENTOPROPRIETARIO:'FISICA', TIPOREMARCACAOCHASSI:'NORMAL', UF:uf,
    VALORTOTALDEBITOMULTA:money(fineCents), VEIANOFABR:fabr, VEIANOMODELO:modelYear, VEICATEGORIA:'PARTICULAR', VEIPROCEDENCIA:'NACIONAL'
  };
  return {CONSULTA_PLACA:plate, PAYLOAD:{CONSULTA:{CODIGORESPOSTA:'SANDBOX',DATAHORA:new Date().toISOString(),LOGON:'SANDBOX',IDCONSULTA:`MOCK-${plate}`},RESPOSTA:{CODIGO:'1',VEICULOSBDRP:{DESCRICAORETORNO:'SUCESSO',RETORNO:r}}}};
}
