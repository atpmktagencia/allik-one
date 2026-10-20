# D.1 — protocolo de conferência humana, pronto para execução

**Estado: preparado; nenhum participante avaliado.** Tempos, ações e erros humanos
continuam não medidos. O benchmark de inferência e o experimento de OCR não são
substitutos deste estudo. Não houve recrutamento nem envio de mensagens.

## Pergunta e condições

Verificar se o filtro por exceções reduz o trabalho **sem aumentar erros residuais**
ou esconder omissões. Não testar diagnóstico, adequação terapêutica ou metas clínicas.

- **A — conferência completa:** interface atual, filtro `Todos`, inspeção de cada linha
  e de seus campos de origem; confirmação individual.
- **B — conferência por exceção:** a mesma interface, filtro `Atenção individual`,
  resolução das pendências, acesso a `Todos` e inspeção de cobertura do original antes
  de `Conferi as N linhas sem pendências`. A confirmação em lote continua uma decisão
  explícita. Nunca instruir o participante a confiar no selo sem abrir a fonte.

Os dois comportamentos já existem em `src/components/clinic/laboratory-review.tsx`.
Não é necessário redesenhar a aplicação para comparar esses modos de uso. A condição B
não pode esconder definitivamente as linhas elegíveis. Scans sem texto independente
exigem inspeção individual em **ambas** as condições.

## Ambiente e proteção

1. Usar cópia local descartável do componente atual, com respostas HTTP sintéticas
   reproduzidas a partir das capturas versionadas. Fixar SHA, viewport (1440 × 900),
   navegador, PDFs/hashes, versão do verificador e conjunto de tarefas.
2. Isolar totalmente a sessão de estudo do Preview e da produção. Bloquear tráfego
   externo no navegador. Interceptar **todas** as rotas `/api/`; leituras recebem somente
   fixtures autorizadas. Mutações de rascunho, se necessárias à tarefa, ficam em memória.
   `EXTRACT`, `VALIDATE`, `REOPEN`, envio e downloads remotos devem ser bloqueados.
   Não habilitar `SAVE` real. Reiniciar a cópia em memória entre tarefas.
3. Antes de recrutar, testar os bloqueios por tentativa de acesso inesperado e registrar
   que nenhum request saiu da cópia local. Sem essa verificação, não iniciar o estudo.
4. Rotular o ambiente como **SINTÉTICO — ESTUDO — NÃO SALVA NO PRONTUÁRIO**. Não inserir
   dados de participantes ou pacientes reais nas respostas. Usar IDs como P01; não
   pedir nome, CPF, e-mail, gravação de voz ou informações de saúde.
5. O encerramento da tarefa exporta somente o registro anônimo do estudo. Nenhuma
   ação cria resultado validado. O gabarito permanece separado da tela do participante.

Esse isolamento é um requisito de execução futura, **a cópia de estudo ainda não foi
implementada nem homologada nesta entrega**. O protocolo e as planilhas não significam
que a infraestrutura de coleta já esteja pronta.

## Pessoas e desenho experimental

Piloto exploratório com oito profissionais habituados a conferir exames, sem pretensão
de poder estatístico ou validação clínica. Treinamento de cinco minutos em um PDF que
não faça parte das tarefas medidas; mesmas instruções e equipamento para todos.

Cada participante executa seis tarefas, três A e três B, sem rever o mesmo PDF.
Alocar ciclicamente as seguintes sequências; em cada sequência, os documentos D1–D6
mantêm sua identidade e a ordem da lista define a apresentação:

| Sequência | Ordem de apresentação  | Condições nas posições 1–6 |
| --------- | ---------------------- | -------------------------- |
| S1        | D1, D2, D3, D4, D5, D6 | A, B, A, B, A, B           |
| S2        | D6, D5, D4, D3, D2, D1 | A, B, A, B, A, B           |
| S3        | D1, D2, D3, D4, D5, D6 | B, A, B, A, B, A           |
| S4        | D6, D5, D4, D3, D2, D1 | B, A, B, A, B, A           |

Repetir S1–S4 uma vez para oito pessoas. Cada documento aparece em ambas as condições,
sem confundir modalidade documental com condição de revisão. A ordem inversa reduz,
mas não elimina, efeitos de aprendizagem/fadiga. Comparar por documento e participante;
não tratar linhas de um mesmo documento como participantes independentes.

## Tarefas e gabarito do moderador

Os PDFs abaixo já estão versionados em `src/test/fixtures/laboratory-robustness-pdfs`.
As referências independentes estão em `src/test/fixtures/laboratory-robustness.ts`.
Usar saídas reais capturadas somente onde existirem. Uma tarefa manipulada é um
**controle sintético**, nunca um resultado observado do modelo ou do verificador.

| Tarefa | PDF                              | O que deve ser conferido                                                                               |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| D1     | `dates-explicit-ddmm`            | 1 resultado, três datas com papéis distintos e formato declarado                                       |
| D2     | `dates-ambiguous-no-format`      | resultado legível; três datas permanecem sem interpretação; não escolher formato pelo idioma           |
| D3     | `geometric-current-previous`     | três resultados atuais, sem trocar pela coluna anterior; unidades e referências respectivas            |
| D4     | `scan-rotated`                   | dois resultados; localizar a imagem e resolver orientação; conteúdo sem evidência textual independente |
| D5     | `scan-partially-masked`          | TSH legível; não inventar Ferritina numérica; reconhecer o valor realmente oculto                      |
| D6     | `many-pages-repeated-parameters` | oito páginas, 24 observações atuais; repetir nomes em outra coleta não é duplicação                    |

Para medir erros não percebidos quando a extração real estiver correta, preparar antes
do recrutamento uma segunda bateria **controlada** em cópias locais:

- troca atual/anterior em uma célula de D3;
- unidade incompatível em uma linha, preservando seu nome;
- data de emissão copiada para coleta;
- uma linha omitida em D6;
- um número inventado para Ferritina mascarada;
- um erro com sinal de elegibilidade artificial, para medir viés de automação.

Não modificar o PDF ou o gabarito para acompanhar o erro inserido. Guardar um manifesto
separado com campo, antes/depois, versão e hash da cópia, além de `outputOrigin:
controlled_usability_mutation`. Um caso intencionalmente elegível não deve ser descrito
como falha real do v3. Distribuir as mesmas mutações pelas condições A/B entre pessoas;
não mostrar a mesma variante ao mesmo participante. Analisar a bateria controlada
separadamente das tarefas com saídas reais. Não gerar novas inferências para o estudo.

Instrução comum: “Confira o que pode ser sustentado pelo documento, corrija o que
conseguir, registre o que precisa permanecer pendente e indique quando terminaria a
conferência. Você pode voltar ao original a qualquer momento. Nada será publicado.”

## Instrumentação e coleta

Usar `docs/benchmarks/laboratory-stage-d1-usability-events.csv` para eventos e
`laboratory-stage-d1-usability-tasks.csv` para o fechamento de cada tarefa. São
**cabeçalhos vazios**, sem resultados humanos inventados.

O relógio começa quando PDF e tabela estão prontos e a instrução é encerrada. Termina
quando o participante declara conclusão, mesmo que haja erro residual. Registrar
separadamente latência de carregamento, interrupções e pedidos de ajuda. Parar a tarefa
após oito minutos; marcar `censored=true`, sem descartá-la das análises.

Eventos com `performance.now()` relativo ao início: `task_start`, `filter_change`,
`original_open`, `original_page_change`, `zoom`, `rotate`, `details_open`, `field_edit`,
`line_add`, `line_remove`, `individual_confirm`, `bulk_confirm`, `help_request`,
`visibility_hidden`, `visibility_visible`, `task_end`. Contar uma ação por ativação de
controle, não cada tecla de um número digitado; uma edição termina em blur/Enter.
Gravar campo/linha/página e tipo de ação, evitando texto livre e dados de identidade.
Registrar rolagem separadamente, agrupada em sessões, sem inflar ações por pixel.

Depois de cada tarefa perguntar, sem sugerir resposta:

1. “Foi difícil localizar no original a informação necessária?” (1 muito fácil–7 muito difícil).
2. “Quão confiante está na conferência?” (1–7).
3. “Qual informação continuou ambígua?” (moderador classifica; não pedir dados pessoais).

O moderador coteja a cópia final contra a referência **depois** do encerramento. Registrar:

- erros existentes na entrada e percebidos, corrigidos ou deixados pendentes corretamente;
- erros existentes não percebidos ou aceitos;
- erros introduzidos durante a revisão;
- parâmetros legíveis omitidos que continuam ausentes;
- campos indevidamente preenchidos apesar de ilegibilidade/ambiguidade;
- tempo até localizar a primeira evidência relevante e número de páginas abertas.

“Percebido” exige indicação explícita ou ação correspondente; silêncio não prova percepção.
Uma pendência legítima mantida não conta como falha. Um campo vazio cuja fonte é ambígua
não conta como omissão de dado recuperável. Erros de resultado, unidade, data e associação
atual/anterior têm rótulos separados; não mascarar erro crítico em uma média de acertos.

## Análise predefinida e critérios de decisão

Relatar mediana, intervalo observado e diferenças por pessoa/documento para tempo e
ações. Com oito pessoas, não fazer alegações populacionais com p95 ou um percentual
agregado de centenas de células. Relatar tarefas censuradas e ajuda recebida.

Segurança é o desfecho principal: comparar erros residuais por tipo, incluindo omissões
e viés de elegibilidade. Revisão por exceção só merece nova avaliação se não aumentar
erros críticos, não reduzir a verificação do original e não ocultar parâmetros ausentes.
Uma amostra sem erros não prova risco zero. Qualquer aceitação de número mascarado,
unidade errada ou resultado anterior como atual exige investigação antes de expansão.

Redução de tempo e ações é um desfecho secundário; não anunciar economia antes de
medição com pessoas. Alta confiança com erro não percebido é um achado adverso.
Revisão humana não corrige automaticamente falhas de completude do pipeline.

Próximo passo depende de aprovação: preparar a cópia local bloqueada, verificar a
instrumentação, executar o piloto e então decidir sobre mudanças na conferência.
