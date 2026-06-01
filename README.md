# Home Studio BI

PWA estático para GitHub Pages com dashboard de faturamento, Meta Ads, transações, atendentes e notificações locais.

## Como publicar

1. Suba estes arquivos para um repositório no GitHub.
2. Ative o GitHub Pages apontando para a branch principal e a raiz do projeto.
3. No celular, abra a URL publicada e use "Adicionar à Tela de Início".

## Configuração do app

Edite `config.js` e preencha `apiUrl` com a URL do Web App do Google Apps Script:

```js
window.HSBI_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/SEU_ID/exec",
  metaTaxRate: 0.1383,
  rowsPerPage: 10,
  autoRefreshMinutes: 15,
  retentionDays: 180
};
```

O site atualiza ao abrir, ao tocar em `Atualizar` e automaticamente a cada 15 minutos.
Enquanto `apiUrl` estiver vazio, ele usa dados demonstrativos locais para você revisar o layout.
Ao atualizar, ele carrega até 180 dias de transações e pré-carrega Meta Ads para Hoje, Ontem, Últimos 7 dias, Este mês e Mês passado.
`Últimos 7 dias` significa os 7 dias anteriores, sem incluir hoje.

## Planilha Google

A planilha precisa apenas da aba `Transações`. O Apps Script cria os cabeçalhos automaticamente:

`id`, `timestamp`, `data`, `hora`, `pagador`, `telefone`, `moeda`, `valor`, `atendente`, `origem`, `moeda_original`, `valor_original`, `cotacao_brl`

Essas colunas formam o espelho editável das transações. O app usa `moeda` e `valor` já em BRL. Se a venda chegar em outra moeda, o Apps Script converte para Real e preserva a moeda e o valor originais nas últimas colunas.

## Google Apps Script

1. Crie uma planilha no Google Planilhas.
2. Abra `Extensões > Apps Script`.
3. Cole o conteúdo de `apps-script/Code.gs`.
4. Em `Configurações do projeto > Propriedades do script`, adicione:
   - `META_ACCESS_TOKEN`: token da Meta.
   - `META_AD_ACCOUNT_ID`: ID da conta de anúncios, com ou sem `act_`.
   - `META_API_VERSION`: opcional, exemplo `v25.0`.
   - `RETENTION_DAYS`: opcional, padrão `180`.
   - `MAX_TRANSACTION_ROWS`: opcional, padrão `60000`.
   - `CURRENCY_RATES_JSON`: opcional, exemplo `{"USD":5.25,"EUR":5.70}`. Use apenas se quiser travar cotações manualmente ou se o `GOOGLEFINANCE` não retornar alguma moeda.
   - `LEAD_ACTION_TYPES_JSON`: opcional. O padrão conta somente o `action_type` exato `lead`.
5. Implante como `App da Web`, executando como você e com acesso para qualquer pessoa com o link.

Use a URL do Web App tanto no `config.js` quanto no webhook da Zapdata.

O Apps Script cria uma aba oculta `Cotações` quando precisar converter moedas estrangeiras para BRL.

Para descobrir exatamente quais eventos a Meta está retornando, abra:

`SUA_URL_DO_APPS_SCRIPT?action=metaActions&from=2026-06-01&to=2026-06-01`

Veja os `action_type` retornados e, se a coluna "Leads" da sua Meta estiver usando outro nome exato, coloque esse nome em `LEAD_ACTION_TYPES_JSON`, por exemplo:

`["lead"]`

## Payload da Zapdata

Envie `POST` com JSON:

```json
{
  "valor": "{{event_value}}",
  "pagador": "{{contactName}}",
  "telefone": "{{telefone}}",
  "moeda": "BRL",
  "atendente": "Sheila"
}
```

Para vendas automáticas, envie `"atendente": "Automação"`.
Se vier `"moeda": "USD"` ou outra moeda, o valor será convertido para Real antes de aparecer no app.

## Notificações

A aba de notificações contém o resumo, a lista de horários e um botão de teste. Sem servidor de push dedicado, os avisos por horário funcionam melhor com o app instalado e aberto ou recentemente ativo. Web push real com entrega garantida em segundo plano exigiria um backend com VAPID/assinaturas.
