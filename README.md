# Home Studio BI

PWA para GitHub Pages com dashboard de faturamento, Meta Ads, transações, atendentes e Web Push.

## Como publicar

1. Suba estes arquivos para um repositório no GitHub.
2. Ative o GitHub Pages apontando para a branch principal e a raiz do projeto.
3. No celular, abra a URL com slug publicada e use "Adicionar à Tela de Início".

Links com slug:

- BI principal: `/x7p4r9m2/`
- App da Sheila: `/k9v2m7q4/`

A raiz do projeto fica sem `index.html` de propósito, para retornar erro/404 e deixar os apps acessíveis apenas pelos slugs.

Se o ícone antigo continuar aparecendo depois de atualizar, remova o atalho da Tela de Início e adicione novamente usando a URL com `?v=30`.

## Configuração do app

Edite `config.js` e preencha `apiUrl` com a URL do Web App do Google Apps Script:

```js
window.HSBI_CONFIG = {
  apiUrl: "https://script.google.com/macros/s/SEU_ID/exec",
  metaTaxRate: 0.1383,
  rowsPerPage: 10,
  autoRefreshMinutes: 15,
  retentionDays: 730
};
```

O site atualiza ao abrir, ao tocar em `Atualizar` e automaticamente a cada 15 minutos.
Enquanto `apiUrl` estiver vazio, ele usa dados demonstrativos locais para você revisar o layout.
Ao atualizar, ele carrega transações do início do mês passado até hoje e pré-carrega Meta Ads para Hoje, Ontem, Últimos 7 dias, Este mês e Mês passado.
Períodos personalizados fora dessa janela buscam as transações sob demanda.
`Últimos 7 dias` significa os 7 dias anteriores, sem incluir hoje.

## Planilha Google

A planilha precisa apenas da aba `Transações`. O Apps Script cria os cabeçalhos automaticamente:

`id`, `timestamp`, `data`, `hora`, `pagador`, `telefone`, `moeda`, `valor`, `atendente`, `origem`, `moeda_original`, `valor_original`, `cotacao_brl`, `comissao_percentual`

Essas colunas formam o espelho editável das transações. O app usa `moeda` e `valor` já em BRL. Se a venda chegar em outra moeda, o Apps Script converte para Real e preserva a moeda e o valor originais nas últimas colunas.
O campo `comissao_percentual` é preenchido no momento em que a venda chega pelo webhook, usando a comissão configurada para o atendente naquele instante.

O Apps Script também cria a aba `Atendentes`:

`slug`, `nome`, `comissao_percentual`, `salario_fixo_mensal`

Para usar mais de uma meta ao mesmo tempo, o Apps Script cria a aba `Metas`:

`slug`, `meta_titulo`, `meta_valor`, `meta_premio`, `meta_ativa`

Cada linha é uma meta. Use o mesmo `slug` da atendente. Quando `meta_ativa` vira `TRUE`, o Apps Script grava internamente o momento de ativação e a barrinha passa a contar as comissões a partir dali. Quando trocar para `FALSE`, essa memória é limpa; se voltar para `TRUE`, a contagem começa de novo, mesmo que a meta seja idêntica.

Para a Sheila, o slug inicial é `k9v2m7q4`. A página dela fica em:

`https://SEU_USUARIO.github.io/SEU_REPOSITORIO/k9v2m7q4/`

## Google Apps Script

1. Crie uma planilha no Google Planilhas.
2. Abra `Extensões > Apps Script`.
3. Cole o conteúdo de `apps-script/Code.gs`.
4. Em `Configurações do projeto > Propriedades do script`, adicione:
   - `META_ACCESS_TOKEN`: token da Meta.
   - `META_AD_ACCOUNT_IDS`: IDs das contas de anúncios, com ou sem `act_`. Para várias contas, separe os IDs por vírgula; para uma conta, informe apenas um ID.
   - `META_API_VERSION`: opcional, exemplo `v30.0`.
   - `RETENTION_DAYS`: opcional, padrão `730`.
   - `MAX_TRANSACTION_ROWS`: opcional, padrão `500000`.
   - `GALLERY_WEBHOOK_SECRET`: chave usada para validar os upsells aprovados enviados pela galeria.
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

## Webhook da Cakto

No painel da Cakto, acesse `Integrações > Webhooks`, crie um webhook e use:

- Nome: `Home Studio BI`
- URL: `SUA_URL_DO_APPS_SCRIPT?atendente=Automa%C3%A7%C3%A3o&hsbi_key=SUA_CHAVE_SECRETA`
- Evento: `purchase_approved`
- Produtos: selecione os produtos cujas vendas devem entrar no dashboard
- Chave secreta: pode usar a mesma senha de `CAKTO_WEBHOOK_SECRET`

O Apps Script reconhece o payload oficial da Cakto e registra:

- `data.paidAt` como data e hora
- `data.customer.name` como pagador
- `data.customer.phone` como telefone
- `data.amount` como valor
- `BRL` como moeda
- `Cakto` como origem
- `data.id` como identificador único, evitando duplicações em reenvios

Configure apenas `purchase_approved`. Eventos como Pix gerado ou boleto gerado ainda não representam pagamento confirmado.

## Notificações

A aba de notificações contém o resumo, a lista de horários e um botão de teste. Os avisos são enviados pelo backend Web Push na Vercel.

No app da atendente, o aviso usa o título `Venda Realizada! 💰` e é disparado pelo Apps Script quando uma nova venda da Sheila entra na planilha.

## Web Push com Vercel

O backend de Web Push fica em `push-server`. O site continua hospedado no GitHub Pages.

1. Na Vercel, importe este repositório como um novo projeto.
2. Em `Root Directory`, selecione `push-server`.
3. No Marketplace da Vercel, conecte um banco Upstash Redis ao projeto.
4. Em `Settings > Environment Variables`, adicione:
   - `VAPID_SUBJECT`: `mailto:SEU_EMAIL`.
   - `VAPID_PUBLIC_KEY`: a mesma chave pública configurada em `config.js`.
   - `VAPID_PRIVATE_KEY`: chave privada VAPID, somente na Vercel.
   - `PUSH_API_SECRET`: segredo compartilhado com o Apps Script.
   - `ALLOWED_ORIGINS`: origem do GitHub Pages, como `https://usuario.github.io`.
5. Faça o deploy e teste `https://SEU_PROJETO.vercel.app/api/health`.
6. Em `config.js`, coloque a URL final da Vercel em `pushApiUrl`.
7. Nas propriedades do Apps Script, adicione:
   - `PUSH_API_URL`: URL final da Vercel.
   - `PUSH_API_SECRET`: o mesmo segredo da Vercel.
   - `OWNER_APP_URL`: URL completa do slug principal.
   - `SHEILA_APP_URL`: URL completa do slug da Sheila.
8. Atualize e implante uma nova versão do Apps Script.
9. Execute `setupOwnerPushTriggers` uma vez para criar a verificação dos horários a cada 5 minutos.

No iPhone, Web Push exige iOS 16.4 ou mais recente e o app adicionado à Tela de Início. A permissão deve ser solicitada dentro do app instalado.
