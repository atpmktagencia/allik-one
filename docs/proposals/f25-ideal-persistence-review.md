# Ideal — proposta de persistência aguardando aprovação

O schema atual não possui metas clínicas individualizadas. Reutilizar resultados laboratoriais ou metadados de documentos para guardar metas alteraria contratos clínicos existentes e não ofereceria versionamento adequado. Proposta: uma tabela append-only de eventos de metas, separada dos resultados, com origem e autoria explícitas.

[Diff SQL proposto](f25-ideal-targets.sql). Não está no journal nem no diretório de migrations executáveis. Nenhum SQL desta proposta foi aplicado, inclusive no Preview. O editor implementado guarda apenas rascunhos em memória do workspace; não os aplica às cores nem os apresenta como configurações efetivas.

## Identidade e versionamento

Stream imutável por organização/unidade, escopo, destinatário, biomarcador, modalidade e unidade literal. Revisões sequenciais e operation_id por organização; lock transacional do stream e revisão esperada. Edição = novo DEFINED. Desativação = novo DISABLED, preservando limites e motivo. Cada evento possui autoria e data de gravação. Uma revisão nunca reescreve a configuração anterior nem o resultado confirmado.

## Leitura proposta

Resolver escopo autorizado antes de oferecer a meta ao cálculo. Precedência explícita proposta: Paciente > Profissional autenticado > Organização, sempre na unidade autorizada. Em cada stream considerar a última decisão vigente para a data da coleta/resultado; ausência de data, ambiguidade de múltiplos streams ativos para a mesma chave ou unidade/modalidade incompatível implica não aplicar meta. Uma desativação posterior não altera silenciosamente a leitura histórica anterior à vigência. Explicitar no painel qual configuração/versão foi utilizada. Definir antes da ativação se desativar um escopo deve permitir fallback; proposta conservadora: decisão DISABLED vigente bloqueia fallback nesse contexto.

O backend deverá impedir criação concorrente de streams ativos para a mesma chave (lock da identidade além do lock de stream), validar revisão esperada e comparar payload em replay do operation_id. O SQL não substitui esses controles. Configurações sobrepostas/retroativas exigem revisão explícita e auditoria; não modificar documentos finalizados nem snapshots já emitidos.

## Autorização a implementar e testar antes da aplicação

- Reutilizar sessão, organização, pacientes, unidades autorizadas e auditoria clínica existentes.
- Paciente: profissional com permissão clínica efetiva para o paciente e ambas as unidades pertinentes.
- Profissional: somente o próprio profissional autorizado; atribuir ator pela sessão, nunca pelo payload.
- Organização: exigir capacidade administrativa clínica expressa, a definir no catálogo de permissões; `users.manage` não confere esse poder. Não habilitar automaticamente para PARTNER_ADMIN.
- SELECT/INSERT exclusivamente; sem UPDATE, DELETE ou TRUNCATE. O papel de runtime não é owner. O acesso direto do browser continua proibido; sem endpoints genéricos de tabela.
- Trigger verifica integridade organizacional e sequência; autenticação, papel e autorização efetiva ficam no backend. Não tratar a membership isolada como autorização.
- Validar estado ativo da organização, unidade, paciente, usuário e membership, correspondência da unidade, escopo, limites numéricos finitos, datas, motivo e chave canônica no servidor.
- O SQL é proposta revisável: depende de testes em PostgreSQL descartável de schema real, segurança, payload, concorrência, overlap e replay antes de integrar migration oficial.

## Rollback não destrutivo

Antes de uso, uma transação com falha é revertida atomicamente. Após qualquer evento persistido: desligar flag/endpoints, conservar tabela, índices, triggers, eventos e journal; nenhuma migration down destrutiva automática. Clientes exibem “Meta indisponível” e não aplicam valores não recuperados. Exportação auditada de eventos e validação de contagens/hashes precedem eventual manutenção futura. Nenhum resultado clínico original precisa ser restaurado porque não é alterado por metas.

## Aprovação solicitada

Aprovar a proposta de persistência, o SQL e as regras de escopo para iniciar implementação/testes de backend em banco descartável. A aplicação no Preview deve ter autorização separada após apresentação dos resultados; produção permanece fora de escopo. Até lá, a edição de Ideal é um rascunho explicitamente não aplicado, sem falsa confirmação de salvamento clínico.
