# F1 — Central de Documentos com recebimento único

**Implementada somente em Preview**, candidato `a99712079deff8a1fc0df6d7260f2183b8f27218`,
branch `feature/allik-patients`. Sem F2–F5, chamadas pagas, novo prompt, migration ou
promoção de produção.

- [Preview fixo](https://allik-one-git-feature-allik-patients-atp-mkt.vercel.app).
- [Deployment imutável testado](https://allik-h1z8fw0b6-atp-mkt.vercel.app).

## Alterações

O `PatientDocumentCenter` continua a ser a biblioteca única. Seu formulário de envio
foi substituído por uma área compacta para arrastar/soltar ou selecionar vários arquivos.
Cada arquivo recebe uma operação estável, progresso real de transferência, confirmação
de armazenamento, falha/interrupção e tentativa explícita. A fila é sequencial.

Nome vem do arquivo; não há campo obrigatório de título, data ou categoria. A categoria
opcional vale para os próximos arquivos selecionados e fica congelada naquela operação.
O contrato antigo de categorias múltiplas continua disponível no backend; na interface
é possível selecionar até oito categorias antes do envio, sem valor clínico padrão.

**Recebimento neutro sem migration:** o banco exige uma categoria conhecida. Usamos
`OTHER` como valor técnico existente e auditamos `intent:RECEIPT`, `receiptVersion:1`
no evento `UPLOADED`. A UI mostra **Sem classificação**, separando o recebimento de
uma categoria escolhida. O backend recusa `RECEIPT` com categoria clínica. Não há
classificação automática, nem criação de import laboratorial ao receber arquivos.

O arquivo neutro não abre o componente de conferência laboratorial. Um PDF identificado
explicitamente como laboratório pode continuar usando as funções manuais existentes.
Nenhuma ação de IA ou validação é disparada automaticamente.

A lista preserva busca, filtros, lista/tabela, origem e estados. Uploads exibem data de
recebimento, sem alterar datas anteriores do documento. A prévia continua contextual,
aberta somente por seleção. Não há visualizador vazio permanente antes de selecionar.

## Segurança, duplicação e integração

Mesmos endpoints, armazenamento privado, validação de bytes, SHA-256, locks por operação
e conteúdo, permissões por organização/paciente/unidade e auditoria. A reabertura por
`documentId` passa pelo mesmo filtro autorizado, não por URL pública de armazenamento.

Depois de resposta de rede ambígua, “Tentar novamente” mantém UUID, arquivo e metadata.
O servidor reconcilia a operação já armazenada antes de escrever outro blob. Duplicado
oferece o original; repetição intencional continua exigindo justificativa e nova operação.
Remover um erro da fila não apaga nenhum original do servidor.

O mesmo componente é usado pela Central e pelo diálogo já existente do atendimento;
não há segundo uploader. Invalidação das consultas da biblioteca atualiza outras vistas
do mesmo paciente. Arquivos com categoria de exame escolhida aparecem também em Exames
com **o mesmo sourceId**. Neutros ficam na Central até classificação posterior; não são
falsamente exibidos como exames. Sua reabertura funciona mesmo fora do filtro atual.

Navegar entre Documentos/Exames preserva a fila. O estado existente do diálogo guarda a
fila durante seu fechamento/reabertura: envio em andamento é interrompido no cliente e
pode ser reconciliado explicitamente ao voltar. Não há retomada automática em background.
A anamnese e os editores existentes não foram substituídos ou reiniciados.

## Testes efetivamente executados

| Verificação                               | Resultado                              |
| ----------------------------------------- | -------------------------------------- |
| Unitários/interface do projeto            | **586 passaram**, 81 arquivos          |
| Integração em PostgreSQL 16 descartável   | **464 passaram**, 39 arquivos          |
| Provisionamento/papel restrito            | **3 passaram**                         |
| Typecheck e lint dos arquivos alterados   | passaram                               |
| E2E local `e2e/laboratory-review.spec.ts` | **1 passou**, fluxo completo em 27,5 s |
| Navegador no Preview                      | **12 verificações**, descritas abaixo  |

Integrações verificam permissões, escopo, integridade, duplicação concorrente, resultado
ambíguo do COMMIT e recebimento neutro idempotente. Interface/transporte verificam upload
simples/múltiplo, drop, tamanho inválido, progresso, falha de rede, resposta inválida,
interrupção, preservação de UUID, reabertura da fila e repetição justificada. Nenhum
teste automatizado é métrica de produtividade humana.

O primeiro E2E não iniciou por ausência do navegador esperado. A repetição usou o
executável Chrome explicitamente pelo mecanismo já existente em `playwright.config.ts`
e passou, sem alterar a aplicação ou o banco remoto. O runner descartável foi restrito
a esse spec. Não se declara que toda a suíte E2E foi executada.

## Demonstração real no Preview

[Registro do navegador](benchmarks/patient-f1-preview-flow.json), em 1440 × 1000:

1. Abrir paciente sintético → Documentos. Área compacta, sem formulário obrigatório.
2. Selecionar dois PDFs juntos. Ambos recebidos, sequencialmente, como Sem classificação.
3. Reabrir e baixar os originais. SHA-256 das respostas igual aos bytes enviados.
4. Enviar o mesmo arquivo novamente. HTTP 409, acesso ao existente e nenhuma nova cópia.
5. Simular perda da resposta **depois** do armazenamento. A UI mostra falha; a tentativa
   explícita retorna a identidade existente, sem duplicar o documento.
6. Alternar Documentos/Exames e voltar. Fila preservada.
7. Abrir o original em painel privado. Resposta/iframe conferidos; ressalva visual abaixo.
8. Enviar outro PDF com categoria laboratorial escolhida explicitamente. Central e
   Exames retornam o mesmo sourceId, sem ação de laboratório.

Foram recebidos **quatro documentos sintéticos**, incluindo o arquivo da resposta perdida;
não cinco ou seis cópias por causa das tentativas. Nenhum import laboratorial F1 foi criado.
O navegador registrou **zero POSTs de OPEN/EXTRACT/VALIDATE**. O contador global de eventos
de extração ficou em 25, antes e depois. Histórico validado continuou com 88 resultados e
mesmo digest `713f44bd5c8fa62783847475c61a3525`.

Produção permaneceu em `dpl_4ag81mHUxsDZ7VaKqnrKKHqKrFkp`, SHA
`091612549723e484d41bd3c984e877ddd19365e6`.
[Preservação e alvo testado](benchmarks/patient-f1-preservation.json).

## Capturas e comparação visual

- [Central antes do envio](screenshots/patient-f1/01-central.jpg).
- [Recebimento múltiplo](screenshots/patient-f1/02-recebidos.jpg).
- [Duplicado sem nova cópia](screenshots/patient-f1/03-duplicado.jpg).
- [Resposta perdida reconciliada](screenshots/patient-f1/04-retentativa.jpg).
- [Painel do original no navegador headless](screenshots/patient-f1/05-original.jpg).

As capturas foram revisadas contra a identidade aprovada de Anamnese: barra global,
cabeçalho clínico horizontal, navegação contextual, branco/cinza claro, bordas discretas
e teal preservados. O recebimento ocupa uma única área compacta; não há dashboard novo.
A seleção abre o painel direito e reduz apenas a área da lista, sem reestruturar o shell.

**Limitação visual comprovada:** o PDF nativo não desenhou seu conteúdo na captura
headless; o frame aparece branco. A resposta privada, MIME, bytes e SHA foram verificados,
mas a presença do iframe não comprova renderização visual do PDF. A F1 reutiliza o viewer
nativo anterior e oferece download. Não se adicionou biblioteca de PDF ou rasterização
para mascarar essa limitação. Vale homologar o viewer no navegador utilizado pela clínica.

## Arquivos principais e limites

- `src/components/clinic/patient-document-center.tsx`: entrada única, seleção/reabertura,
  estados e atualização da biblioteca compartilhada.
- `src/components/clinic/patient-document-upload.tsx`: fila, drop/múltiplos, progresso,
  interrupção, erros, duplicado e repetição explícita.
- `src/data/patient-document-transfer.ts`: uma tentativa XHR abortável, sem retry automático.
- `src/server/patient-document-center.ts`: recebimento neutro auditado e leitura por identidade
  com as mesmas permissões; data de recebimento e estado de classificação separados.
- `src/test/patient-document-center-ui.test.tsx`, `src/test/patient-document-transfer.test.ts`
  e `src/server/patient-documents-security.test.ts`: regressões.

A fila usa apenas memória: reload completo perde arquivos ainda não recebidos e seu
estado local; não há cache offline, fila durável ou upload em background. Originais já
confirmados permanecem na biblioteca. Trocar paciente/unidade não reaproveita a fila do
contexto anterior. Upload cancelado pode já ter chegado ao servidor; a tentativa com
mesmo UUID é a forma segura de conferir, não uma garantia de desfazer o armazenamento.

Formatos mantidos: PDF, JPEG e PNG, até 4 MB por arquivo. Arquivos inválidos falham
individualmente. Categoria posterior depende de F2 porque os metadados originais são
imutáveis. Recebimento não equivale a resultado clínico validado.

## Próxima aprovação

[Proposta detalhada F2](patient-ai-first-f2-proposal.md): classificação sugerida e
corrigível, documentos mistos, contrato, corpus, proveniência, alternativas de persistência,
orçamento e critérios de teste. **Não implementada.** F2–F5 e produção aguardam aprovação.
