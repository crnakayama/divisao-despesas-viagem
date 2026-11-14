# Divisão de Despesas de Viagem

Web app para dividir despesas de viagem em família: cada pessoa lança o que pagou, em qualquer moeda, e todos veem em tempo real quanto têm a receber ou a pagar em R$.

Não tem instalação nem etapa de build: são arquivos estáticos (`index.html`, `app.js`, `store.js`, `calc.js`, `style.css`, `firebase-config.js`).

## 1. Configurar o Firebase (uma vez, gratuito)

Sem este passo o app funciona apenas em **modo local** (dados só no aparelho, sem compartilhamento).

1. Acesse <https://console.firebase.google.com> com uma conta Google e clique em **Criar um projeto** (o Google Analytics pode ficar desativado).
2. No menu lateral, abra **Criação → Firestore Database → Criar banco de dados**. Escolha uma região (ex.: `southamerica-east1`) e o **modo de produção**.
3. Na aba **Regras** do Firestore, substitua o conteúdo por este e clique em **Publicar**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /viagens/{viagem} {
         allow get, create, update: if true;
         allow list, delete: if false;
         match /despesas/{despesa} {
           allow read, write: if true;
         }
       }
     }
   }
   ```

   Com essas regras, só quem tem o link (que contém o código da viagem) consegue ler e editar; ninguém consegue listar as viagens existentes.
4. Na página inicial do projeto (ícone de engrenagem → **Configurações do projeto → Geral → Seus apps**), clique no ícone **Web `</>`**, dê um apelido e registre o app. Não é preciso marcar Firebase Hosting.
5. Copie os valores do bloco `firebaseConfig` que aparece e cole em `firebase-config.js`, no lugar dos `COLE_AQUI`.

Essas chaves identificam o projeto e podem ficar no código publicado; a proteção vem das regras do passo 3.

## 2. Publicar (gratuito)

**Netlify (mais simples):** entre em <https://app.netlify.com/drop> e arraste a pasta inteira. O site ganha uma URL permanente, que pode ser renomeada nas configurações.

**GitHub Pages:** crie um repositório, envie os arquivos e ative em **Settings → Pages → Deploy from a branch** (branch `main`, pasta `/root`).

## 3. Usar

1. Abra a URL, dê um nome à viagem, adicione os participantes e toque em **Criar viagem**.
2. Toque em **Convidar** e mande o link no grupo do WhatsApp. Cada pessoa abre e escolhe o próprio nome.
3. **+ Despesa** lança um gasto: quem pagou, valor, moeda, categoria, data, descrição e entre quem dividir.
4. **Saldos** mostra quem tem a receber e quem deve; **Despesas** traz o histórico com filtros (toque num item para editar ou excluir); **Acerto** lista as transferências mínimas e o resumo para compartilhar.

## Como funciona

- **Cotações:** ao escolher a moeda, o app busca a cotação do Banco Central Europeu na [Frankfurter API](https://frankfurter.dev) para a data da despesa (as cotações saem em dias úteis; em fins de semana vale a última disponível). Sem conexão, ou se preferir, digite a cotação. Cada despesa guarda valor original, moeda, cotação e valor em R$, e nunca é recalculada depois.
- **Saldos:** o valor em R$ de cada despesa é dividido igualmente entre as pessoas marcadas; quem pagou fica com crédito do total. As contas são feitas em centavos inteiros.
- **Acerto:** o app procura o menor número de transferências que zera todos os saldos.
- **Sem sinal:** com o app já aberto, lançamentos feitos offline ficam guardados e sobem quando a conexão volta. Para abrir o app é preciso internet.
- **Participante adicionado depois:** entra nas próximas despesas; as já lançadas não mudam (edite-as se quiser incluí-lo).

## Limites desta versão

Sem senha (quem tem o link edita), sem fotos de comprovantes, sem notificações e sem remoção de participantes.

## Testar no computador

O app usa módulos JavaScript, então precisa de um servidor local (não abre direto pelo arquivo):

```bash
python -m http.server 8765
```

Depois abra <http://localhost:8765>.
