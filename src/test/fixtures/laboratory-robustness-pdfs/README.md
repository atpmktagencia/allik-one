# Corpus sintético de robustez — Etapa D

Este diretório contém apenas documentos inventados para avaliação de software. Nomes, valores, unidades e intervalos são exemplos sintéticos, sem paciente real e sem finalidade de orientação clínica.

As 12 referências foram escritas manualmente em `../laboratory-robustness.ts`, separadas dos textos-fonte e do código de renderização. Não são saídas de modelo nem previsões controladas. O manifesto registra por caso os hashes SHA-256, páginas, modalidade, tags, contagem de observações legíveis e incertezas que não podem ser resolvidas pelo original.

Para regenerar offline, na raiz do repositório:

```sh
npx tsx scripts/generate-laboratory-robustness.ts
```

Usa PDFKit já instalado; os rasters usam Python 3, Pillow e a fonte de sistema DejaVu Sans. Esses recursos são exclusivos do gerador e não adicionam dependência ao runtime da aplicação. As datas de metadados PDF, o ruído e a renderização são determinísticos. Regeneração em outra versão de fonte/Pillow pode mudar bytes; uma mudança de hash exige revisão explícita.

Os rasters são construídos do zero pelo script `scripts/generate-laboratory-robustness-rasters.py`. O arquivo `raster-spec.json` documenta o texto desenhado e as transformações. O caso rotacionado é degradado e girado em 90 graus; o parcialmente ilegível contém um retângulo no lugar do resultado de Ferritina, e nenhum número oculto é desenhado ou inserido no PDF. O caso mascarado possui uma referência legível (TSH), enquanto Ferritina consta apenas em `expectedUnresolved`.

O documento de oito páginas possui 24 observações atuais distintas: três parâmetros em cada página, com datas de coleta independentes. O mesmo nome em páginas diferentes não é duplicata. O número 2,9 de TSH aparece somente como resultado anterior e não deve virar observação atual.

O caso geométrico desenha células por coordenadas em cinco colunas, sem separadores `|`. O texto achatado não é prova suficiente da associação entre coluna atual, anterior, unidade e referência. A referência foi determinada pelo layout desenhado; o verificador textual deve continuar conservador quando perder essa geometria.

Datas numéricas ambíguas sem declaração de formato não recebem uma interpretação inventada: o valor laboratorial continua na referência, mas os três campos temporais são nulos e identificados como `ambiguous_date`. Nulos nesses campos não devem ser tratados como ausência genuína na fonte.

Limites: apenas um nível de degradação e uma rotação; oito páginas não exercitam o limite máximo de 100; o corpus não certifica legibilidade universal, validade clínica ou segurança de publicação. Os originais dos scans não possuem camada textual independente; uma leitura visual da IA continua exigindo revisão.
