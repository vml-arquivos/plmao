const cents = (v) => {
    if (typeof v !== 'string' && typeof v !== 'number')
        return 0;
    const s = String(v).trim();
    if (!s)
        return 0;
    const normalized = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = Number(normalized);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const text = (v) => Array.isArray(v) ? (v[0] ?? undefined) : (v == null ? '' : String(v).trim()) || undefined;
const ok = (v) => !text(v) || /NADA CONSTA|NAO POSSUI|NÃO POSSUI|OK|NAO EXISTE/i.test(text(v));
const key = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function recordsFrom(raw) {
    const result = [];
    const seen = new Set();
    const visit = (value, depth) => {
        if (depth > 5 || seen.has(value))
            return;
        if (isRecord(value)) {
            seen.add(value);
            result.push(value);
            Object.entries(value).forEach(([entryKey, entryValue]) => {
                if (depth < 5 && (isRecord(entryValue) || Array.isArray(entryValue)) && /resposta|retorno|veiculo|veiculos|vehicle|data|result|resultado|dados|response|content|body|extra/i.test(entryKey))
                    visit(entryValue, depth + 1);
            });
        }
        else if (Array.isArray(value)) {
            value.slice(0, 5).forEach((item) => visit(item, depth + 1));
        }
    };
    visit(raw, 0);
    return result;
}
function valueOf(raw, aliases) {
    const wanted = new Set(aliases.map(key));
    for (const record of recordsFrom(raw)) {
        for (const [field, value] of Object.entries(record)) {
            if (wanted.has(key(field)) && value != null && value !== '')
                return value;
        }
    }
    return undefined;
}
function successfulResponse(raw) {
    const responseCode = valueOf(raw, ['CODIGO', 'codigoResposta', 'statusCode', 'httpStatus']);
    if (responseCode == null || responseCode === '')
        return true;
    const normalized = key(String(responseCode));
    return normalized === '1' || normalized === '200' || normalized === 'OK' || normalized === 'SUCCESS' || normalized === 'SUCESSO';
}
export function normalizeBdrp(raw) {
    if (!successfulResponse(raw))
        throw new Error('Resposta do provedor inválida');
    const plate = text(valueOf(raw, ['PLACA', 'plate', 'licensePlate', 'placaVeiculo']));
    const brand = text(valueOf(raw, ['MARCA', 'brand', 'make', 'marcaVeiculo']));
    const model = text(valueOf(raw, ['MODELO', 'model', 'modeloVeiculo']));
    const fullModel = text(valueOf(raw, ['MARCAMODELOCOMPLETO', 'marcaModeloCompleto', 'marcaModelo', 'marca_modelo', 'fullModel', 'fullVehicleModel']));
    if (!plate || (!brand && !model && !fullModel))
        throw new Error('Resposta do provedor inválida');
    const debtAliases = [
        ['VALORTOTALDEBITOMULTA', 'valorTotalDebitoMulta', 'finesAmount'],
        ['EXISTEDEBITODELICENCIAMENTOVL', 'debitoLicenciamento', 'licensingDebt'],
        ['DEBIPVA', 'debitoIpva', 'ipvaDebt'],
        ['DEBDETRAN', 'debitoDetran'],
        ['DEBDER', 'debitoDer'],
        ['DEBPOLRODFED', 'debitoPrf'],
        ['DEBRENAINF', 'debitoRenainf'],
        ['DEBMUNICIPAIS', 'debitoMunicipal']
    ];
    const restrictionAliases = [
        ['RESFURTO', 'furtoRoubo', 'theftRestriction'],
        ['RESJUDICIAL', 'restricaoJudicial', 'judicialRestriction'],
        ['RESRENAJUD', 'renajud'],
        ['RESADMINISTRATIVA', 'restricaoAdministrativa'],
        ['RESTRIBUTARIA', 'restricaoTributaria'],
        ['RESTRICAOFINAN', 'restricaoFinanceira'],
        ['RESTRICAORFB', 'restricaoReceitaFederal'],
        ['RESAMBIENTAL', 'restricaoAmbiental']
    ];
    const recall = text(valueOf(raw, ['RECALL', 'recall']));
    return {
        identification: {
            plate,
            renavam: text(valueOf(raw, ['RENAVAM', 'renavam'])),
            chassis: text(valueOf(raw, ['CHASSI', 'chassis', 'chassi'])),
            engine: text(valueOf(raw, ['MOTOR', 'engine', 'numeroMotor'])),
            gearbox: text(valueOf(raw, ['NUMEROCAIXACAMBIO', 'gearbox', 'cambio', 'numeroCambio'])),
            brand,
            model,
            fullModel
        },
        characteristics: {
            manufactureYear: text(valueOf(raw, ['VEIANOFAB', 'anoFabricacao', 'ano', 'manufactureYear', 'fabricationYear'])),
            modelYear: text(valueOf(raw, ['VEIANOMODELO', 'anoModelo', 'ano_modelo', 'modelYear'])),
            color: text(valueOf(raw, ['COR', 'color'])),
            fuel: text(valueOf(raw, ['COMBUSTIVEL', 'fuel', 'combustivel', 'combustível'])),
            power: text(valueOf(raw, ['POTENCIA', 'power'])),
            displacement: text(valueOf(raw, ['CILINDRADA', 'displacement'])),
            type: text(valueOf(raw, ['TIPO', 'type', 'vehicleType', 'tipoVeiculo', 'tipo_veiculo'])),
            species: text(valueOf(raw, ['ESPECIE', 'species'])),
            category: text(valueOf(raw, ['VEICATEGORIA', 'categoria', 'category'])),
            body: text(valueOf(raw, ['CARROCERIA', 'body', 'bodyType'])),
            axles: text(valueOf(raw, ['EIXOS', 'axles'])),
            passengers: text(valueOf(raw, ['CAPACIDADEPASSAG', 'passageiros', 'passengers'])),
            loadCapacity: text(valueOf(raw, ['CAPACIDADECARGA', 'capacidadeCarga', 'loadCapacity'])),
            origin: text(valueOf(raw, ['VEIPROCEDENCIA', 'procedencia', 'origin']))
        },
        registration: {
            city: text(valueOf(raw, ['MUNICIPIO', 'municipio', 'municipality', 'city', 'cidade'])),
            state: text(valueOf(raw, ['UF', 'ufPlaca', 'uf_placa', 'estado', 'state'])),
            licensingDate: text(valueOf(raw, ['LICDATA', 'dataLicenciamento', 'licensingDate'])),
            licensingYear: text(valueOf(raw, ['LICEXELIC', 'anoLicenciamento', 'licensingYear'])),
            status: text(valueOf(raw, ['SITUACAOVEICULO', 'situacaoVeiculo', 'status', 'vehicleStatus']))
        },
        owner: {
            name: text(valueOf(raw, ['PRONOME', 'nomeProprietario', 'ownerName'])),
            document: text(valueOf(raw, ['CPF_CNPJ_PROPRIETARIO', 'cpfCnpjProprietario', 'ownerDocument'])),
            documentType: text(valueOf(raw, ['TIPODOCUMENTOPROPRIETARIO', 'tipoDocumentoProprietario', 'ownerDocumentType']))
        },
        debts: [
            ['MULTAS', 'Multas', debtAliases[0]],
            ['LICENCIAMENTO', 'Licenciamento', debtAliases[1]],
            ['IPVA', 'IPVA', debtAliases[2]],
            ['DETRAN', 'DETRAN', debtAliases[3]],
            ['DER', 'DER', debtAliases[4]],
            ['PRF', 'Polícia Rodoviária Federal', debtAliases[5]],
            ['RENAINF', 'RENAINF', debtAliases[6]],
            ['MUNICIPAIS', 'Débitos municipais', debtAliases[7]]
        ].map(([debtKey, label, aliases]) => { const value = valueOf(raw, aliases); return { key: String(debtKey), label: String(label), amountCents: cents(value), hasDebt: cents(value) > 0 }; }),
        restrictions: [
            ['FURTO', 'Furto/Roubo', restrictionAliases[0]],
            ['JUDICIAL', 'Judicial', restrictionAliases[1]],
            ['RENAJUD', 'RENAJUD', restrictionAliases[2]],
            ['ADMIN', 'Administrativa', restrictionAliases[3]],
            ['TRIBUTARIA', 'Tributária', restrictionAliases[4]],
            ['FINANCEIRA', 'Financeira', restrictionAliases[5]],
            ['RFB', 'Receita Federal', restrictionAliases[6]],
            ['AMBIENTAL', 'Ambiental', restrictionAliases[7]]
        ].map(([restrictionKey, label, aliases]) => { const status = valueOf(raw, aliases); return { key: String(restrictionKey), label: String(label), status: text(status) ?? 'SEM INFORMACAO', alert: !ok(status) }; }),
        recall,
        coverage: {
            identification: 'FOUND',
            debts: debtAliases.some((aliases) => valueOf(raw, aliases) !== undefined) ? 'FOUND' : 'NOT_QUERIED',
            restrictions: restrictionAliases.some((aliases) => valueOf(raw, aliases) !== undefined) ? 'FOUND' : 'NOT_QUERIED',
            recall: recall ? 'FOUND' : 'NOT_QUERIED'
        }
    };
}
export function normalizeFipe(raw) {
    const price = typeof raw?.price === 'string' ? raw.price : typeof raw?.valor === 'string' ? raw.valor : raw?.price;
    const normalizedPrice = String(price ?? '').trim().replace(/^R\$\s*/i, '').replace(/\./g, '').replace(',', '.');
    const value = Number(normalizedPrice);
    if (!raw || !Number.isFinite(value) || value <= 0)
        throw new Error('FIPE_INVALID_RESPONSE');
    const vehicleType = raw.vehicleType === 2 || raw.tipoVeiculo === 2 || raw.tipoVeiculo === '2' ? 'motorcycles' : raw.vehicleType === 3 || raw.tipoVeiculo === 3 || raw.tipoVeiculo === '3' ? 'trucks' : 'cars';
    const brand = { code: String(raw.brandCode ?? raw.codigoMarca ?? raw.marcaCodigo ?? '').trim(), name: String(raw.brand ?? raw.marca ?? '').trim() };
    const model = { code: String(raw.modelCode ?? raw.codigoModelo ?? raw.modeloCodigo ?? '').trim(), name: String(raw.model ?? raw.modelo ?? '').trim() };
    const year = { code: String(raw.yearCode ?? raw.codigoAno ?? raw.anoCodigo ?? '').trim(), name: String(raw.year ?? raw.ano ?? raw.modelYear ?? raw.anoModelo ?? '').trim() };
    if (!brand.name || !model.name || !year.name || !String(raw.codeFipe ?? raw.codigoFipe).trim())
        throw new Error('FIPE_INVALID_RESPONSE');
    const referenceMonth = String(raw.referenceMonth ?? raw.mesReferencia ?? raw.referencia ?? '').trim();
    if (!referenceMonth)
        throw new Error('FIPE_REFERENCE_MISSING');
    return {
        provider: String(raw.provider ?? 'fipe').trim(),
        source: String(raw.source ?? 'Tabela FIPE').trim(),
        consultedAt: new Date().toISOString(),
        referenceMonth,
        referenceCode: raw.referenceCode == null ? undefined : String(raw.referenceCode),
        vehicleType,
        brand,
        model,
        year,
        fuel: String(raw.fuel ?? raw.combustivel ?? '').trim() || undefined,
        modelYear: Number.isFinite(Number(raw.modelYear ?? raw.anoModelo)) ? Number(raw.modelYear ?? raw.anoModelo) : undefined,
        fipeCode: String(raw.codeFipe ?? raw.codigoFipe).trim(),
        valueCents: Math.round(value * 100),
        valueLabel: `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    };
}
