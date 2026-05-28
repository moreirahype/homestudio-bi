# HOMESTUDIO BI - Deploy

## 1. Atualizar o Apps Script

1. Abra a planilha Google.
2. Va em **Extensoes > Apps Script**.
3. Substitua o conteudo pelo arquivo `apps_script/Code.gs`.
4. Salve.
5. Recarregue a planilha.
6. Rode **Wise > Corrigir estrutura da planilha**.
7. Rode **Wise > Configurar PIN admin do site** se quiser editar atendentes pelo app.

## 2. Publicar o endpoint JSON

1. No Apps Script, clique em **Implantar > Nova implantacao**.
2. Tipo: **App da Web**.
3. Executar como: **Voce**.
4. Quem pode acessar: **Qualquer pessoa com o link**.
5. Clique em **Implantar**.
6. Copie a URL do app da web.

Depois, na planilha, o menu **Wise > Ver URL do site/API** tambem mostra a URL se a implantacao existir.

## 3. Ligar o site ao endpoint

Edite `site/config.js`:

```js
window.HOMESTUDIO_BI_CONFIG = {
  apiUrl: 'COLE_A_URL_DO_APP_DA_WEB_AQUI',
  defaultPeriod: 'today',
  currency: 'BRL'
};
```

O PIN admin nao vai no `config.js`. Ele deve ser digitado na pagina **Atendentes** apenas quando for salvar alteracoes.

## 4. Publicar no GitHub Pages

1. Crie um repositorio no GitHub, por exemplo `homestudio-bi`.
2. Envie apenas o conteudo da pasta `site`.
3. No GitHub, va em **Settings > Pages**.
4. Source: **Deploy from a branch**.
5. Branch: `main`.
6. Folder: `/root`.
7. Salve.

A URL gratis ficara parecida com:

`https://seuusuario.github.io/homestudio-bi/`

Nao precisa comprar dominio. Dominio proprio fica opcional depois.

## 5. Instalar no celular

1. Abra a URL no navegador do celular.
2. Use **Adicionar a tela inicial**.
3. O app aparece como **HOMESTUDIO BI** com o icone criado.

## Atualizacao manual

- Na planilha: **Wise > Sincronizar ultimos 30 dias**.
- No site: botao **Atualizar** apenas recarrega os dados publicados pelo endpoint.

## Meta Ads

O dashboard ja calcula ROAS, CPA, lucro e margem usando o investimento total:

`Gasto Meta + Imposto Meta Ads`

O gasto vem automaticamente da Meta Ads pelo Apps Script. Configure na planilha:

1. **Wise > Configurar Meta Ads**
2. **Wise > Diagnostico da Meta Ads**

O site nao guarda token da Meta e nao tem campo manual de gasto.
