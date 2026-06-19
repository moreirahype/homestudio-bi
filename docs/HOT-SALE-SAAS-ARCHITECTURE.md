# Hot Sales SaaS

## Estratégia

A versão comercial será construída em paralelo ao app legado, no mesmo repositório. O app atual continua operacional durante toda a migração.

- Frontend/PWA: aplicação Hot Sales hospedada na Vercel.
- Autenticação e banco: Supabase Auth + Postgres.
- Isolamento: Row Level Security por workspace.
- Backend: rotas server-side da Vercel para webhooks, Meta OAuth, sincronização e push.
- Google Sheets: integração/importação opcional, não banco principal do SaaS.
- Push: Web Push associado a usuário e workspace, não a slugs fixos.

## Modelo de dados

### workspaces

- id
- name
- slug
- owner_user_id
- plan
- subscription_status
- created_at

### workspace_members

- workspace_id
- user_id
- role
- can_create_manual_sales (somente para atendentes, definido pelo dono)

### transactions

- id (UUID)
- workspace_id
- external_id (opcional)
- occurred_at
- payer_name (opcional)
- amount_brl
- original_amount
- original_currency
- source: manual, webhook, gateway, import
- attendant_id (opcional)
- product_id (opcional)
- created_by (opcional)
- created_at

Uma venda manual exige apenas `amount_brl`. O servidor cria UUID e horário. Atendentes só podem lançar vendas manuais se `can_create_manual_sales` estiver ativo.

### webhook_integrations

- id
- workspace_id
- provider
- token_hash
- enabled
- last_received_at

Cada workspace recebe uma URL e um token próprios. O payload normalizado aceita aliases como `valor`, `amount`, `pagador`, `payer`, `atendente` e `seller`.

### meta_connections

- workspace_id
- meta_user_id
- encrypted_access_token
- token_expires_at
- status

### meta_ad_accounts

- workspace_id
- account_id
- account_name
- enabled

O dashboard permite visualizar todas as contas habilitadas ou uma conta específica. A seleção é aplicada aos gastos, conversas/leads e métricas derivadas.

### products

- id
- workspace_id
- name
- active
- created_at

O lançamento manual continua exigindo apenas valor. Produto é um campo opcional e pode usar um produto padrão.

### subscriptions

- workspace_id
- provider: kiwify
- provider_customer_id
- provider_subscription_id
- status
- current_period_end
- affiliate_id (opcional)
- updated_at

O acesso ao app depende do status sincronizado por webhook da Kiwify. Eventos são idempotentes e o backend mantém um período de tolerância para atrasos de webhook.

### entitlements

- workspace_id
- feature_key: attendants, extra_meta_accounts, advanced_notifications
- status: trialing, active, past_due, canceled
- quantity
- trial_ends_at
- current_period_end
- provider_subscription_item_id (opcional)

O módulo de atendentes deve ser controlado por entitlement próprio. Assim o plano base pode continuar barato e o dono ativa gestão de equipe apenas quando precisar.

### dashboard_settings

- workspace_id
- conversation_metric_mode: leads ou messaging_conversations
- meta_tax_rate
- timezone
- currency

Quando o modo for `messaging_conversations`, o dashboard exibe `Conversas` e `Custo por conversa`. Todos os custos usam gasto Meta + imposto.

### notification_settings

- workspace_id
- sale_enabled
- report_times
- report_style: profit_status, detailed_summary ou creative
- timezone

### push_subscriptions

- workspace_id
- user_id
- endpoint_hash
- subscription_json
- enabled

### creative_messages

- id
- polarity: profit ou loss
- title_template
- body_template
- enabled

As mensagens criativas serão autorais. A escolha será aleatória, evitando repetir mensagens usadas recentemente no mesmo workspace.

## Experiência do produto

### Lançamento manual

1. Usuário toca em `Nova venda`.
2. Digita o valor.
3. Toca em `Registrar venda`.
4. O servidor registra UUID, data, hora, origem manual e atualiza o dashboard.
5. Se o usuário for atendente, a venda manual só é aceita quando o dono tiver liberado essa permissão.

### Integrações

- Webhook: URL individual, token, payload de exemplo, botão copiar e histórico do último recebimento.
- Zapdata: tutorial textual inicial e espaço reservado para vídeo do YouTube.
- Outros provedores: usam o mesmo webhook normalizado.
- Meta: botão `Conectar com Facebook`, seleção das contas de anúncio e teste da conexão.
- Kiwify: checkout de assinatura, webhooks de pagamento/renovação/cancelamento e bloqueio de acesso.

### Atendentes

- Recurso condicionado ao entitlement `attendants`.
- O dono convida atendentes por e-mail.
- Cada atendente possui login próprio e vê somente seus dados.
- O dono pode abrir uma visualização segura `Ver como atendente`.
- O dono acompanha metas, comissão, vendas e ganhos sem precisar do link ou senha da atendente.
- Metas e comissão são administradas pelo dono.
- O add-on pode começar com trial de 3 ou 7 dias com cartão cadastrado.
- Modelo inicial sugerido: preço por atendente ativo ou pacote de até 3 atendentes.
- O dono define se cada atendente pode lançar vendas manuais. Quando liberado, essas vendas entram atribuídas à própria atendente.

### Produtos

- Tabela equivalente à análise de atendentes.
- Total de vendas, faturamento e ticket médio por produto.
- Gráfico comparativo com participação percentual na receita.
- Filtro de produto no dashboard: todos ou um produto específico.

### Indique e ganhe

- Página interna mostra link de afiliado da Kiwify.
- Exibe instruções, cliques/vendas quando disponíveis pela integração e regras de comissão.
- A Kiwify continua responsável pelo checkout e pagamento de comissões.

### Notificações

#### Venda

- Toggle único.
- Título: `Venda aprovada!`
- Corpo: `Valor: R$ 99,90`
- Prévia com identificação `Hot Sales`.

#### Relatório

- Horários configuráveis.
- Status de lucro: mensagem fixa positiva ou negativa.
- Resumo detalhado: investimento, faturamento, CPA e ROAS.
- Criativas: mensagem autoral aleatória conforme lucro ou prejuízo.
- Todas as opções possuem prévia.

## Segurança

- Tokens Meta nunca ficam no navegador.
- Tokens e segredos são criptografados no backend.
- Todas as tabelas possuem RLS por workspace.
- Webhooks usam token revogável e proteção contra duplicidade.
- Operações manuais exigem sessão autenticada.
- Slugs não são mecanismo de segurança.

## Fases

1. Criar app Hot Sales, Supabase, autenticação e workspaces.
2. Criar banco, RLS e lançamento manual.
3. Criar webhook por workspace e tela de integrações.
4. Criar Meta OAuth, seleção de contas e modos Leads/Conversas.
5. Migrar dashboard e transações.
6. Migrar e expandir Web Push.
7. Criar onboarding, assinatura e entitlements de add-ons.
8. Importar dados do app legado e validar PWA.

## Decisões comerciais iniciais

- Nome: Hot Sales.
- Oferta inicial: um plano principal para reduzir atrito.
- Preço principal recomendado: R$ 97/mês.
- Trimestral como economia: R$ 201 a cada 3 meses, apresentado como R$ 67/mês.
- Add-on de atendentes: recurso pago separado, com trial de 3 ou 7 dias após cadastro do cartão.
- Afiliados: 30% recorrente enquanto a assinatura indicada estiver ativa, sujeito à validação operacional na Kiwify.
- Garantia: 7 dias.
- Depoimentos mínimos para lançamento: 5 reais e autorizados; ideal entre 6 e 8.
