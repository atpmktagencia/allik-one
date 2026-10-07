<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- Keep demonstration records in `src/data/mock-clinic.ts` behind a local data boundary so `/api/v1/` can replace them without rewriting the UI.
- Keep the Allik One inventory navigation focused on operational stock workflows. Do not expose unfinished Clinic OS prototype modules from the inventory shell.
- Inventory persists in PostgreSQL and uses individual Pilot identities in production. Enforce organization, unit scope and permission on every server-side read and write; hiding UI is not authorization.
- Keep demo patients separate from persisted inventory. Do not store real patient data in synthetic application fields.
- Preview uses an isolated synthetic database and shared demonstration access only. Pilot, Preview and test databases must remain separate.
- Production maintenance, bootstrap, migrations and one-time imports must be explicit administrative commands. Never mutate the Pilot database as a side effect of an application build.
