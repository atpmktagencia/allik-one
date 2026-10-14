# Clinical document fonts

Unmodified Liberation Sans regular, bold, italic and bold-italic fonts provide
Portuguese, Latin, Greek and common medical/math symbols in generated PDFs.
See LICENSE.txt for the SIL Open Font License and copyright notices.

The server embeds subsets from these font bytes. `src/server/clinical-document-fonts.ts`
contains deterministic gzip (mtime=0), base64 copies of each TTF, so serverless
bundles require neither system fonts nor runtime asset paths. Keep that generated
module synchronized if these source fonts change. Do not modify font names or
license notices.

The PDF renderer checks glyph coverage before writing text. Characters outside
these fonts' coverage cause an explicit error, rather than disappearing or being
substituted in a clinical document.
