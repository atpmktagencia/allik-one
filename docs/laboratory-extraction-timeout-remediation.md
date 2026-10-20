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

O resultado do reprocessamento do PDF reportado será registrado após a publicação no Preview.
