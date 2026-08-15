import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * 🏦 Busca taxa PTAX oficial do BACEN
 * API: https://www.bcb.gov.br/api/
 * Documentação: https://www.bcb.gov.br/dados/series
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parsear requisição
    const body = await req.json();
    const { targetDate, lag = 1 } = body;

    if (!targetDate) {
      return Response.json(
        { error: 'targetDate é obrigatório (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // Calcular data de busca (com lag)
    const searchDate = new Date(targetDate + 'T00:00:00');
    searchDate.setDate(searchDate.getDate() - lag);
    const searchStr = searchDate.toISOString().split('T')[0];

    // 🔐 API BACEN (Séries Temporais)
    // Série 1: USD (PTAX) - taxa de fechamento
    // Documentação: https://www.bcb.gov.br/dados/Series (buscar por "PTAX")
    const bacenUrl = `https://www.bcb.gov.br/api/v1/dados/serie/1/dados?formato=json`;

    console.log(`📊 Buscando PTAX no BACEN para ${searchStr}`);

    const response = await fetch(bacenUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FinCalc/1.0 (BACEN Data Consumer)'
      }
    });

    if (!response.ok) {
      throw new Error(`BACEN API retornou ${response.status}`);
    }

    const data = await response.json();

    // Parser: BACEN retorna array com [{data, valor}]
    // Procurar a taxa mais recente <= searchStr
    let foundRate = null;

    if (data.valor && Array.isArray(data.valor)) {
      // Reverter para procurar backward (mais recente primeira)
      for (let i = data.valor.length - 1; i >= 0; i--) {
        const item = data.valor[i];
        
        // Converter formato DD/MM/YYYY → YYYY-MM-DD
        const [day, month, year] = item.data.split('/');
        const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        
        // Procurar taxa <= searchStr
        if (dateStr <= searchStr) {
          foundRate = {
            rate_date: dateStr,
            ptax_rate: parseFloat(item.valor),
            source: 'BCB_OFFICIAL',
            series_id: 'BCB_PTAX_USD_OFFICIAL',
            fetched_at: new Date().toISOString()
          };
          break;
        }
      }
    }

    if (!foundRate) {
      // Fallback: retornar última taxa disponível
      if (data.valor && data.valor.length > 0) {
        const lastItem = data.valor[data.valor.length - 1];
        const [day, month, year] = lastItem.data.split('/');
        const dateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        
        foundRate = {
          rate_date: dateStr,
          ptax_rate: parseFloat(lastItem.valor),
          source: 'BCB_LAST_AVAILABLE',
          series_id: 'BCB_PTAX_USD_OFFICIAL',
          fetched_at: new Date().toISOString(),
          warning: `Taxa para ${searchStr} não disponível, usando última: ${dateStr}`
        };
      }
    }

    if (!foundRate) {
      return Response.json(
        { error: 'Nenhuma taxa PTAX disponível no BACEN', data: data },
        { status: 404 }
      );
    }

    console.log(`✅ PTAX encontrada: ${foundRate.ptax_rate} em ${foundRate.rate_date}`);

    return Response.json({
      success: true,
      official: foundRate,
      targetDate: targetDate,
      lag: lag
    });

  } catch (error) {
    console.error('🚨 Erro ao buscar PTAX:', error);
    return Response.json(
      { 
        error: error.message,
        details: 'Verifique a conectividade com BACEN e tente novamente'
      },
      { status: 500 }
    );
  }
});