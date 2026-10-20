/**
 * Retorno seguro para clientes finais.
 *
 * O normalizador mantém owner apenas para uso interno/controlado; nenhum
 * identificador nominal ou documental do proprietário deve atravessar as
 * rotas de histórico, consulta ou exportação do cliente.
 */
export function publicVehicleResult(vehicle) {
    const { owner: _owner, ...publicResult } = vehicle;
    return publicResult;
}
/**
 * Remove recursivamente chaves pessoais de payloads configuráveis de relatório.
 * Isso funciona como defesa adicional para produtos criados no painel, sem
 * alterar o resultado normalizado interno armazenado para auditoria.
 */
const privateField = /^(owner|ownername|ownerdocument|ownerdocumenttype|propriet|nomeproprietario|cpfcnpjproprietario|cpf|cnpj|document|address|endereco|street|logradouro|phone|telefone|email|chassi|chassis|renavam|engine|motor)$/i;
export function redactPrivateFields(value) {
    if (Array.isArray(value))
        return value.map(redactPrivateFields).filter((child) => child !== undefined);
    if (!value || typeof value !== 'object')
        return value;
    const sanitized = Object.fromEntries(Object.entries(value)
        .filter(([key]) => !privateField.test(key.replace(/[^A-Za-z0-9]/g, '')))
        .map(([key, child]) => [key, redactPrivateFields(child)])
        .filter(([, child]) => child !== undefined));
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
const auditPrivateField = /(owner|propriet|cpf|cnpj|document|address|endereco|street|logradouro|phone|telefone|email)/i;
export function sanitizeAuditMetadata(value) {
    if (Array.isArray(value))
        return value.map(sanitizeAuditMetadata).filter((child) => child !== undefined);
    if (!value || typeof value !== 'object')
        return value;
    const sanitized = Object.fromEntries(Object.entries(value)
        .filter(([key]) => !auditPrivateField.test(key))
        .map(([key, child]) => {
        if (key.toLowerCase() === 'plate' && typeof child === 'string') {
            return [key, child.length >= 5 ? `${child.slice(0, 3)}***${child.slice(-2)}` : '***'];
        }
        return [key, sanitizeAuditMetadata(child)];
    })
        .filter(([, child]) => child !== undefined));
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
