# M20A — Composição de receita e protocolos pessoais no Preview

Incremento exclusivo do Preview sintético. Backend, interface e testes foram divididos entre agentes, com integração pela assistência principal; isso não constitui auditoria externa ou liberação em produção.

O profissional responsável pelo atendimento pode informar componentes e respectivas doses/unidades, apresentação, via, orientações e etapas ordenadas da posologia. O sistema soma somente as unidades de administração explicitamente informadas: unidades por administração × administrações por dia × dias. Não converte unidades, sugere doses, verifica compatibilidade ou capacidade de cápsulas, nem classifica medicamentos controlados. Manutenção sem prazo deixa o total indeterminado. Componentes em cápsulas individuais exigem conferência separada das quantidades.

Protocolos são pessoais, restritos ao autor e à organização, sem dados de pacientes. Edições e arquivamento mantêm versões imutáveis. A lista mostra até 100 protocolos ativos. A composição calculada só alimenta um rascunho de receita pelo fluxo existente; o profissional deve revisar antes de salvar/finalizar. Documentos finalizados e seus dados congelados permanecem preservados. A assinatura continua física.

A API exige identidade individual com permissão clínica, escopo das unidades do atendimento e do paciente atual, registro profissional apto e vínculo como profissional responsável. Identidades compartilhadas de demonstração e integrações não podem compor ou gerenciar protocolos.

## Manutenção e verificação

Alvo autorizado: projeto Neon `little-dust-61663559`, branch `br-winter-hill-b69uz195`, banco `neondb`. A migration aditiva `0064_prescription_composer` cria protocolos e versões; não altera registros clínicos existentes. Verificar os 64 hashes anteriores antes da aplicação transacional explícita. Conceder ao runtime acesso operacional aos protocolos e apenas SELECT/INSERT às versões imutáveis, sem TRUNCATE.

O projeto atingiu o limite de branches na rodada anterior; nenhum backup será removido para contornar o limite, e os checkpoints anteriores não representam uma cópia recente deste incremento. Produção permanece fora do escopo.

Verificação concluída: typecheck, build e lint aprovados (seis avisos preexistentes de Fast Refresh); 204 testes unitários e mais dois testes específicos de interface, 260 testes de integração, 11 E2E com runtime restrito, verificações do runtime 3/3 e guardas de build/migration 7/7. O E2E novo confirma cálculo, reutilização de protocolo, revisão explícita e persistência como DRAFT, sem finalização.

Os 64 hashes existentes foram conferidos integralmente antes da transação. A 0064 foi aplicada somente no Preview, que agora possui 65 migrations. A conta restrita recebeu os grants específicos; histórico sem UPDATE/DELETE/TRUNCATE, TEMP negado. Não houve criação de usuários, envio de mensagens ou alteração de credenciais. A base oficial permaneceu com 61 migrations e sem as tabelas do M20.

## M20B — Compositor em três painéis

A biblioteca de protocolos pessoais fica à esquerda; os ativos e a posologia, no centro; a prévia do texto, à direita. Em telas pequenas, o conteúdo se adapta sem exigir três colunas comprimidas. O documento mostrado continua uma prévia, sem finalização ou assinatura automática.

Cada ativo pode ser marcado/desmarcado. O arraste começa no seletor e aplica a mesma intenção aos demais seletores percorridos: iniciar num item marcado desmarca o grupo; iniciar num desmarcado marca o grupo. Os campos de edição e a rolagem não iniciam essa seleção. O clique e o teclado continuam disponíveis. Itens desmarcados mantêm seus valores durante a edição, mas não entram na composição enviada ao servidor ou salva como protocolo. Não selecionar nenhum item bloqueia a composição.

A prévia local acompanha a seleção e os campos válidos; a inserção no rascunho exige novamente a prévia calculada no servidor e confirmação explícita. Qualquer alteração clínica invalida essa confirmação. A mudança é de interface, sem migration ou alteração de permissões, dados de produção ou regras clínicas.

Verificação do M20B: typecheck, build e lint aprovados (somente os seis avisos existentes); 209 testes unitários/interface e 11 E2E aprovados. O navegador exercitou arraste contínuo real, exclusão e nova seleção, conteúdo final do rascunho, disposição desktop e ausência de transbordamento horizontal na largura de 390 px. Nenhuma migration foi necessária. A implantação oficial manteve o mesmo identificador.

## M20C — Referência visual e quantidade de dispensação

A montagem adota linhas compactas com colunas de seleção, ativo, quantidade e unidade, próximas da referência visual enviada. O botão **Modelo da foto · conferir** carrega 63 nomes transcritos das fotografias, inclusive referências das imagens anteriores. É um auxílio editável de transcrição: nomes precisam ser conferidos; trechos ilegíveis não são completados por inferência. Não se copiam dados pessoais presentes nas fotografias.

O modelo abre com todos os componentes desmarcados, quantidades/unidades e posologia vazias, sem via/apresentação predefinidas. Não constitui uma fórmula combinada ou recomendação clínica. O profissional seleciona e informa os campos antes de calcular, salvar ou inserir. O limite de componentes passa a 100 para comportar essa biblioteca; o protocolo enviado contém somente os itens selecionados.

Na coluna do documento, **Quantidade a dispensar** e **Unidade de dispensação** são preenchidas explicitamente. São opcionais como par para preservar os modelos anteriores; quando usadas, devem estar ambas preenchidas, com quantidade decimal positiva. O texto da receita identifica a quantidade informada pelo prescritor separadamente das unidades calculadas da posologia. Não se convertem unidades nem se substitui silenciosamente o cálculo. Editar esses campos invalida a revisão anterior.

Sem migration: os novos campos são opcionais dentro da fórmula JSON existente. A entrega permanece exclusiva do Preview; não cria usuários, não envia mensagens e não altera documentos finalizados ou produção.

Verificação do M20C: typecheck, build e lint aprovados (os seis avisos existentes); 230 testes unitários/interface, 260 de integração, runtime 3/3 e 11 E2E aprovados. O teste de navegador confirma a quantidade/unidade manual no texto salvo e o modelo de referência sem seleção/posologia predefinida; preencher e selecionar o modelo não altera a receita já salva. Revisão visual confirmou cabeçalhos alinhados aos campos e painel de documento separado. Nenhuma migration ou operação no banco oficial foi executada.

## M20D — Posologia inicial e progressão de dose

A área de posologia apresenta o período inicial e o botão **Adicionar aumento de dose**, que abre uma segunda posologia opcional com campos vazios para unidades por administração, administrações por dia e duração em dias. As etapas são sequenciais: o texto calculado informa os intervalos de dias e o início da etapa seguinte após concluir a anterior. Etapas adicionais continuam disponíveis e cada período pode ser removido explicitamente. Não se aumenta dose automaticamente nem se recomenda um valor de titulação.

A progressão altera unidades por administração e frequência/duração informadas; a concentração de cada componente por unidade é preservada. Quantidade a dispensar e unidade permanecem separadas do total de unidades calculado. Uma manutenção sem prazo só pode ser a última etapa e mantém o total indeterminado. Protocolos antigos permanecem compatíveis; documentos já finalizados não são reprocessados.

Sem nova migration ou promoção para produção. A inserção continua limitada a rascunhos com confirmação do profissional, e alterações da posologia invalidam a prévia validada anteriormente.

Verificação do M20D: typecheck, build e lint aprovados (somente seis avisos preexistentes); 232 testes unitários/interface e 11 E2E aprovados. A cobertura nova valida início e fim dos períodos, manutenção após etapa finita, segunda posologia vazia até preenchimento, remoção explícita e quantidade total. O navegador cria a segunda etapa pelo novo botão, confere a sequência na prévia e salva somente um rascunho. A implantação oficial permaneceu com o mesmo identificador.
