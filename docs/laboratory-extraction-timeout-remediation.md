# Extração de exames — timeout no Preview

## Diagnóstico

A importação que motivou a correção falhou duas vezes, após cerca de 62 segundos. O erro foi `EXTRACTION_TIMEOUT` no estágio `PROVIDER`; leitura e integridade do original funcionaram. O arquivo tem 36.901 bytes e seis páginas com texto extraível. A rotina anterior enviava o PDF inteiro ao modelo `openai/gpt-6-luna`, cortava a inferência em 60 segundos e só depois executava o parser textual usado na verificação de evidências.

## Correção

1. Verificar acesso e integridade do original privado, mantendo os limites anteriores.
2. Extrair texto localmente, antes da IA, e reutilizá-lo para conferir as evidências da transcrição.
3. Quando todas as páginas possuem texto suficiente, separar por páginas inteiras: até duas páginas ou 12 mil caracteres por trecho, no máximo duas chamadas simultâneas. A ordem final segue o original, independentemente da ordem das respostas. O arquivo reportado produz três trechos.
4. PDFs mistos, sem texto suficiente, com página acima do limite textual ou fragmentação excessiva mantêm o envio do PDF original ao mesmo provedor. Nenhuma página é omitida para acelerar o processamento.
5. Usar esforço de raciocínio baixo na OpenAI compatível, com `store:false`, mantendo modelo e credencial existentes. Transcrição literal não precisa do orçamento padrão de raciocínio. Nenhum novo provedor ou biblioteca foi introduzido.
6. Validar cada resposta e o conjunto completo. Recusar páginas de origem incompatíveis e mais de 200 resultados; não truncar resultados para aparentar sucesso. Todas as partes devem terminar antes de devolver o rascunho. Uma falha cancela as chamadas restantes e bloqueia publicação parcial. Não há repetição automática de inferência.
7. Conferência do profissional permanece obrigatória: todas as linhas retornam não confirmadas; nenhuma extração cria resultado longitudinal automaticamente.

| Limite                              | Valor                                                       |
| ----------------------------------- | ----------------------------------------------------------- |
| Parser local                        | 8 segundos, inalterado                                      |
| Cada trecho textual                 | 60 segundos                                                 |
| Inferência total da tentativa       | 150 segundos                                                |
| Solicitação no navegador            | 200 segundos                                                |
| Recuperação de tentativa abandonada | após 240 segundos                                           |
| Função Vercel/Nitro                 | máximo explícito de 240 segundos                            |
| Chamadas simultâneas                | 2                                                           |
| Trechos por documento               | até 12; acima disso utiliza o PDF original em chamada única |

Mantidos controle por versão e identificador da tentativa, limite de extrações por organização, auditoria, verificações de organização e unidades e impedimento de substituir conferência já editada. Uma resposta atrasada de tentativa substituída não sobrescreve o rascunho atual.

Logs registram estratégia, duração, quantidade de páginas/trechos/linhas e códigos fixos. Não registram conteúdo do PDF, resultados, prompts, mensagens arbitrárias do provedor ou credenciais.

## Verificação

- Testes novos: paralelismo limitado, conclusão fora de ordem, PDF misto, cancelamento entre trechos, prazo global, provedor que ignora abort, origem de página inválida, limite agregado e conclusão válida após o antigo corte de 60 segundos.
- Integração: parser executado antes da IA; rascunho sem confirmação; histórico anterior preservado; tentativa não recuperável prematuramente em 90 segundos; resposta substituída recusada.
- Build gerado com `maxDuration:240` em `.vc-config.json`.
- Sem migração de banco. Produção fora do escopo.

- Typecheck, build e lint aprovados; apenas os seis avisos anteriores de Fast Refresh.
- Integração PostgreSQL descartável: 432/432, mais 3/3 verificações do papel restrito.
- Extração isolada após o último ajuste: 14/14, incluindo o novo caso de conclusão após 60 segundos.
- Interface laboratorial: 18/18.
- E2E do Paciente360º com conta restrita: aprovado, incluindo revisão de exames, prescrição, salvamento e descarte de rascunhos.

## Reprocessamento do arquivo reportado

No Preview, o candidato `28364c53994020cae2f8b1ab9f5246906e5e2af7` processou o arquivo de seis páginas em três trechos. A inferência terminou em 35.670 ms; o rascunho foi persistido em cerca de 39 segundos. Estado final: `READY_REVIEW`, falha removida, 52 linhas, todas não confirmadas, identificação do paciente ainda pendente de confirmação.

O SHA-256 do original permaneceu `b3f8b01876acd9139f4879e1797eb70aba79b59a3a9e810ceb7e2955687d295c`. Os 37 resultados e a única versão clínica anteriormente confirmados permaneceram intactos. Não foi executada validação clínica nem substituído rascunho editado.

A checagem independente marcou 6 evidências como correspondência literal e 46 com pendências, sobretudo nome não contido no trecho citado. As 52 linhas são candidatas para revisão, não resultados clinicamente validados. Os alertas foram preservados; a correção de timeout não os remove nem amplia a confirmação em lote.

Também foi observada perda da resposta HTTP, embora o servidor tenha persistido a conclusão. A interface agora consulta o estado versionado depois de falha de transporte/JSON, sem reenviar a extração. Se ainda estiver processando, continua acompanhando; se concluída, apresenta o rascunho. Erros 4xx de autorização/conflito não são tratados como sucesso. Consultas atrasadas não sobrescrevem edição local ou uma versão mais nova.

Após essa recuperação de interface: 504 testes unitários/interface aprovados em 76 arquivos. Incluem resposta perdida, JSON inválido, processo ainda ativo, consulta atrasada após edição e acesso negado. Nenhuma chamada adicional paga foi necessária para esses testes.

## Verificação da interface publicada

O candidato `237796e32f9c13b97f845e322bde2607de8b592f`, implantação `dpl_Hcwf451YiQC3ie8rD23FyxLeY2DR`, ficou `READY` e foi associado ao endereço fixo do Preview: https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app.

Em Chromium contra essa implantação, a abertura da conferência recebeu um estado anterior de falha simulado somente no navegador. A requisição de extração foi interrompida pelo teste antes de chegar ao servidor. A interface consultou o estado real persistido, recuperou as 52 linhas e exibiu a mensagem de conclusão. O teste passou sem nova inferência, sem salvar rascunho e sem confirmar resultados.

Após o teste: estado `READY_REVIEW`, versão 6, 52 candidatas, 37 resultados confirmados anteriores e uma versão clínica. O original mantém o mesmo hash. O endereço de produção continuou na implantação `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`.
