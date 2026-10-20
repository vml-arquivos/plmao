import crypto from 'node:crypto';
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose';
import { env, oauthCallbackUrl, publicAppUrl } from './config.js';
import { pool, tx } from './db.js';
const jwksCache = new Map();
function hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}
function randomUrlSafe(bytes = 32) {
    return crypto.randomBytes(bytes).toString('base64url');
}
function providerConfig(provider) {
    if (provider === 'google') {
        if (!env.OAUTH_GOOGLE_CLIENT_ID || !env.OAUTH_GOOGLE_CLIENT_SECRET)
            return null;
        return {
            id: provider,
            displayName: 'Google',
            clientId: env.OAUTH_GOOGLE_CLIENT_ID,
            clientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET,
            issuer: ['https://accounts.google.com', 'accounts.google.com'],
            authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenEndpoint: 'https://oauth2.googleapis.com/token',
            jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
            scopes: ['openid', 'email', 'profile'],
            supportsPkce: true,
            authorizationParams: { access_type: 'online', prompt: 'select_account' }
        };
    }
    if (provider === 'microsoft') {
        if (!env.OAUTH_MICROSOFT_CLIENT_ID || !env.OAUTH_MICROSOFT_CLIENT_SECRET)
            return null;
        const tenant = encodeURIComponent(env.OAUTH_MICROSOFT_TENANT);
        const authority = `https://login.microsoftonline.com/${tenant}/v2.0`;
        return {
            id: provider,
            displayName: 'Microsoft',
            clientId: env.OAUTH_MICROSOFT_CLIENT_ID,
            clientSecret: env.OAUTH_MICROSOFT_CLIENT_SECRET,
            issuer: `https://login.microsoftonline.com/${env.OAUTH_MICROSOFT_TENANT}/v2.0`,
            authorizationEndpoint: `${authority}/oauth2/v2.0/authorize`,
            tokenEndpoint: `${authority}/oauth2/v2.0/token`,
            jwksUri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
            scopes: ['openid', 'email', 'profile'],
            supportsPkce: true,
            authorizationParams: { prompt: 'select_account' }
        };
    }
    if (!env.OAUTH_APPLE_CLIENT_ID || !env.OAUTH_APPLE_TEAM_ID || !env.OAUTH_APPLE_KEY_ID || !env.OAUTH_APPLE_PRIVATE_KEY)
        return null;
    return {
        id: provider,
        displayName: 'Apple',
        clientId: env.OAUTH_APPLE_CLIENT_ID,
        issuer: 'https://appleid.apple.com',
        authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
        tokenEndpoint: 'https://appleid.apple.com/auth/token',
        jwksUri: 'https://appleid.apple.com/auth/keys',
        scopes: ['name', 'email'],
        supportsPkce: true,
        authorizationParams: { response_mode: 'form_post' }
    };
}
export function socialProviderStatus() {
    return ['google', 'microsoft', 'apple'].map((id) => ({ id, label: id === 'google' ? 'Google' : id === 'microsoft' ? 'Microsoft' : 'Apple', enabled: Boolean(providerConfig(id)) }));
}
export async function createAuthorizationRequest(provider) {
    const config = providerConfig(provider);
    if (!config)
        throw oauthError('OAUTH_PROVIDER_NOT_CONFIGURED', 503);
    const state = randomUrlSafe(32);
    const nonce = randomUrlSafe(32);
    const verifier = randomUrlSafe(48);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const expiresAt = new Date(Date.now() + env.OAUTH_STATE_TTL_SECONDS * 1000);
    await pool.query('DELETE FROM oauth_authorization_states WHERE expires_at <= now()');
    await pool.query(`INSERT INTO oauth_authorization_states(provider,state_hash,nonce,code_verifier,expires_at)
    VALUES($1,$2,$3,$4,$5)`, [provider, hash(state), nonce, verifier, expiresAt]);
    const url = new URL(config.authorizationEndpoint);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', oauthCallbackUrl(provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', config.scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('nonce', nonce);
    if (config.supportsPkce) {
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 'S256');
    }
    for (const [key, value] of Object.entries(config.authorizationParams ?? {}))
        url.searchParams.set(key, value);
    return { authorizationUrl: url.toString() };
}
export async function completeAuthorization(provider, input) {
    if (input.error)
        throw oauthError('OAUTH_PROVIDER_DECLINED', 400);
    if (!input.code || !input.state)
        throw oauthError('OAUTH_CALLBACK_INVALID', 400);
    const config = providerConfig(provider);
    if (!config)
        throw oauthError('OAUTH_PROVIDER_NOT_CONFIGURED', 503);
    const state = await consumeState(provider, input.state);
    const tokens = await exchangeCode(config, input.code, state.code_verifier);
    const identity = await verifyIdentity(config, tokens.idToken, state.nonce, input.appleUser);
    const user = await upsertSocialUser(provider, config, identity);
    const ticket = await issueLoginTicket(user.id);
    return { ticket };
}
export function oauthSuccessUrl(ticket) {
    const url = new URL(publicAppUrl());
    url.searchParams.set('oauth_ticket', ticket);
    return url.toString();
}
export function oauthErrorUrl(code) {
    const url = new URL(publicAppUrl());
    url.searchParams.set('oauth_error', code);
    return url.toString();
}
export async function consumeLoginTicket(ticket) {
    if (!/^[A-Za-z0-9_-]{30,160}$/.test(ticket))
        throw oauthError('OAUTH_TICKET_INVALID', 401);
    const result = await pool.query(`DELETE FROM oauth_login_tickets
    WHERE ticket_hash=$1 AND expires_at > now()
    RETURNING user_id`, [hash(ticket)]);
    if (!result.rowCount)
        throw oauthError('OAUTH_TICKET_INVALID', 401);
    const user = await pool.query('SELECT id,email,name,role,active FROM users WHERE id=$1', [result.rows[0].user_id]);
    if (!user.rowCount || !user.rows[0].active)
        throw oauthError('OAUTH_ACCOUNT_UNAVAILABLE', 401);
    return { id: user.rows[0].id, email: user.rows[0].email, name: user.rows[0].name, role: user.rows[0].role };
}
async function consumeState(provider, state) {
    if (!/^[A-Za-z0-9_-]{30,160}$/.test(state))
        throw oauthError('OAUTH_STATE_INVALID', 400);
    const result = await pool.query(`DELETE FROM oauth_authorization_states
    WHERE provider=$1 AND state_hash=$2 AND expires_at > now()
    RETURNING nonce,code_verifier`, [provider, hash(state)]);
    if (!result.rowCount)
        throw oauthError('OAUTH_STATE_INVALID', 400);
    return result.rows[0];
}
async function exchangeCode(config, code, verifier) {
    const form = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        code,
        redirect_uri: oauthCallbackUrl(config.id)
    });
    if (config.supportsPkce)
        form.set('code_verifier', verifier);
    form.set('client_secret', config.id === 'apple' ? await appleClientSecret(config) : String(config.clientSecret));
    const response = await fetch(config.tokenEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: form.toString() });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.id_token)
        throw oauthError('OAUTH_TOKEN_EXCHANGE_FAILED', 502);
    return { idToken: body.id_token };
}
async function appleClientSecret(config) {
    const privateKey = String(env.OAUTH_APPLE_PRIVATE_KEY).replace(/\\n/g, '\n');
    const key = await importPKCS8(privateKey, 'ES256');
    return new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: env.OAUTH_APPLE_KEY_ID })
        .setIssuer(String(env.OAUTH_APPLE_TEAM_ID))
        .setSubject(config.clientId)
        .setAudience('https://appleid.apple.com')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key);
}
async function verifyIdentity(config, idToken, nonce, appleUser) {
    const jwks = jwksCache.get(config.jwksUri) ?? createRemoteJWKSet(new URL(config.jwksUri));
    jwksCache.set(config.jwksUri, jwks);
    const verified = await jwtVerify(idToken, jwks, { audience: config.clientId, issuer: config.issuer });
    const payload = verified.payload;
    if (payload.nonce !== nonce)
        throw oauthError('OAUTH_NONCE_INVALID', 400);
    if (typeof payload.sub !== 'string' || !payload.sub)
        throw oauthError('OAUTH_IDENTITY_INVALID', 401);
    const appleProfile = parseAppleUser(appleUser);
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (!email)
        throw oauthError('OAUTH_EMAIL_REQUIRED', 422);
    const emailVerified = payload.email_verified === undefined ? true : payload.email_verified === true || payload.email_verified === 'true';
    if (!emailVerified)
        throw oauthError('OAUTH_EMAIL_UNVERIFIED', 422);
    const name = (typeof payload.name === 'string' && payload.name.trim()) || appleProfile || email.split('@')[0] || 'Cliente Placa na Mão';
    return { providerAccountId: payload.sub, email, name: name.slice(0, 120), emailVerified, profile: { issuer: payload.iss, email_verified: emailVerified } };
}
function parseAppleUser(value) {
    if (!value)
        return null;
    try {
        const user = JSON.parse(value);
        const name = [user.name?.firstName, user.name?.lastName].filter(Boolean).join(' ').trim();
        return name || null;
    }
    catch {
        return null;
    }
}
async function upsertSocialUser(provider, config, identity) {
    return tx(async (client) => {
        const linked = await client.query(`SELECT u.id,u.email,u.name,u.role,u.active FROM user_identities i
      JOIN users u ON u.id=i.user_id WHERE i.provider=$1 AND i.provider_account_id=$2 FOR UPDATE`, [provider, identity.providerAccountId]);
        if (linked.rowCount) {
            const row = linked.rows[0];
            if (!row.active)
                throw oauthError('OAUTH_ACCOUNT_UNAVAILABLE', 401);
            await client.query(`UPDATE user_identities SET email_at_provider=$3,profile=$4::jsonb,last_used_at=now(),updated_at=now()
        WHERE provider=$1 AND provider_account_id=$2`, [provider, identity.providerAccountId, identity.email, JSON.stringify(identity.profile)]);
            await client.query('UPDATE users SET last_login_at=now() WHERE id=$1', [row.id]);
            return { id: row.id, email: row.email, name: row.name, role: row.role };
        }
        let user = await client.query('SELECT id,email,name,role,active FROM users WHERE lower(email)=lower($1) FOR UPDATE', [identity.email]);
        if (!user.rowCount) {
            const unguessablePassword = await crypto.randomBytes(48).toString('base64url');
            const passwordHash = await import('bcryptjs').then(({ default: bcrypt }) => bcrypt.hash(unguessablePassword, 12));
            user = await client.query(`INSERT INTO users(email,password_hash,name,role,password_enabled,email_verified_at)
        VALUES($1,$2,$3,'CLIENTE',false,now()) RETURNING id,email,name,role,active`, [identity.email, passwordHash, identity.name]);
            await client.query('INSERT INTO wallets(user_id,balance) VALUES($1,0)', [user.rows[0].id]);
            await client.query('INSERT INTO user_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING', [user.rows[0].id]);
        }
        const row = user.rows[0];
        if (!row.active)
            throw oauthError('OAUTH_ACCOUNT_UNAVAILABLE', 401);
        await client.query(`INSERT INTO user_identities(user_id,provider,provider_account_id,issuer,email_at_provider,email_verified_at,profile,last_used_at)
      VALUES($1,$2,$3,$4,$5,now(),$6::jsonb,now())`, [row.id, provider, identity.providerAccountId, Array.isArray(config.issuer) ? config.issuer[0] : config.issuer, identity.email, JSON.stringify(identity.profile)]);
        await client.query('UPDATE users SET last_login_at=now(), email_verified_at=COALESCE(email_verified_at,now()) WHERE id=$1', [row.id]);
        return { id: row.id, email: row.email, name: row.name, role: row.role };
    });
}
async function issueLoginTicket(userId) {
    const ticket = randomUrlSafe(32);
    await pool.query('DELETE FROM oauth_login_tickets WHERE expires_at <= now()');
    await pool.query(`INSERT INTO oauth_login_tickets(user_id,ticket_hash,expires_at)
    VALUES($1,$2,$3)`, [userId, hash(ticket), new Date(Date.now() + env.OAUTH_LOGIN_TICKET_TTL_SECONDS * 1000)]);
    return ticket;
}
function oauthError(code, http) {
    const error = new Error(code);
    error.code = code;
    error.http = http;
    error.expose = true;
    return error;
}
