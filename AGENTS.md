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
- Keep shared Clinic OS navigation and global search in the root application shell so every feature route has the same workspace context.
- Keep the Clinic OS prototype frontend-only until a later phase explicitly introduces persistence, authentication, or integrations, so demonstrations remain isolated and safe.


- Inventory milestone 1 introduces PostgreSQL persistence explicitly. Inventory API is server-only and denies access without a signed Preview session. Keep demo patients separate from persisted inventory. Preview shared access is not production identity or authorization.
