# Estudo local de conferência — D.2

O responsável informou disponibilidade de participantes e autorizou o estudo nesta
conversa. **Ainda não recebemos interações ou registros humanos.** O teste técnico
automatizado não é um participante nem uma medição de produtividade clínica.

## Acesso dos participantes

[Baixar o pacote local](allik-estudo-local.zip). Extraia a pasta e siga `LEIA-ME.txt`.
O pacote não exige conta Allik One, senha, API key ou conexão com Preview.

| Código atribuído pelo moderador | Arquivo                    |
| ------------------------------- | -------------------------- |
| P01–P04                         | `participante-lote-1.html` |
| P05–P08                         | `participante-lote-2.html` |

Em navegador que permita scripts em arquivos locais, abrir o HTML é suficiente.
Se houver bloqueio corporativo de `file://`, execute **na pasta extraída**, com
Node.js 22 ou superior:

```sh
node iniciar-estudo.mjs
```

Abra `http://127.0.0.1:4319/participante-lote-1.html` ou o arquivo do lote 2.
Esse endereço existe somente no computador que iniciou o comando; não é um link
de Preview ou um servidor compartilhado. Ctrl+C encerra. Não requer npm install.
Nesta execução cloud, a política bloqueia `file://`; a validação foi pela origem
loopback, sem remover a política do navegador.

O participante aceita a explicação, faz um treino e seis tarefas, depois exporta
um JSON anônimo. Entregue o JSON ao moderador pelo canal acordado. **Não há envio
automático.** Fechar/recarregar a página descarta a memória. Não coloque nomes,
e-mails ou informações de pacientes nos campos. Todos os documentos já são sintéticos.

## Orientação do moderador

Preservar [o protocolo D.1](../../laboratory-stage-d1-usability.md). P01–P04 recebem
capturas reais históricas; P05–P08 recebem a bateria controlada. Cada bateria percorre
S1–S4 uma vez, com três tarefas A e três B por pessoa, sem repetir PDF na mesma pessoa.
Os arquivos não contêm a bateria alternativa nem o manifesto de correções.

O modelo de oito participantes permite balanceamento dentro de cada bateria. Com
menos pessoas, declarar piloto parcial e verificar o balanceamento; não imputar
observações ausentes ou misturar controle artificial com erro real de IA. Não usar
participantes que já tenham inspecionado o gabarito. O conjunto de dados é pequeno e
selecionado; não é ensaio clínico nem demonstração de não inferioridade.

O componente `LaboratoryReview` é importado sem alterações. Somente neste build de
estudo, o iframe de PDF é substituído por imagens rasterizadas do original, com
páginas/zoom/rotação instrumentados. A barra de estudo adiciona declaração de evidência,
marcação de problema e término. O visualizador e a instrumentação são os mesmos em A/B,
mas diferem do viewer nativo: os tempos absolutos não devem ser extrapolados ao Preview.
O link de nova aba é interceptado para manter a coleta no painel instrumentado.

“Localizei a evidência” é declaração do participante, não rastreamento ocular. Problemas
marcados precisam ser cotejados pelo moderador com o gabarito; ausência de marcação não
prova ausência de percepção. Ajuda, interrupções, não adesão à condição e tarefas
censuradas aos oito minutos devem permanecer na análise. O treino não entra no export.

## Reprodução e análise, somente pelo moderador

Na raiz do repositório, com dependências existentes e `pdftoppm` instalado:

```sh
npx tsx scripts/laboratory-study/build.ts
npx tsx scripts/laboratory-study/smoke.ts
npx tsx scripts/laboratory-study/package.ts
```

O build gera em `work/laboratory-study/` os HTMLs, `moderador.json`, pacote e resultados
do ensaio técnico. **Não entregar o manifesto de correções aos participantes.** Ele
contém hashes e mutações; o gabarito independente continua em
`src/test/fixtures/laboratory-robustness.ts`. O pacote inclui somente HTMLs, instruções
e servidor estático opcional. Nunca contém referências independentes ou logs pessoais.

Depois de receber os registros reais e atestar sua origem humana:

```sh
npx tsx scripts/laboratory-study/report.ts --human-authorized work/laboratory-study/moderador.json P01.json P02.json > work/estudo-humano.json
```

O avaliador rejeita arquivos `automated_smoke`, duplicação de participante e divergência
de build/variante. Calcula tempos, ações, declarações de evidência, avaliações e erros
de campo/residuais contra a referência; percepção correta/incorreta exige adjudicação
do moderador e permanece nula até lá. Não deriva resultado humano de um clique automatizado.

Não subir os exports dos participantes ao GitHub. A entrega desta etapa versiona apenas
os testes técnicos e artefatos sintéticos. Não executar o estudo com documentos reais.
