# Shipping changes to a Raycast extension (SOP)

1. **Worktree.** Do the work in a new git worktree, not on `main`.
2. **TDD.** Write failing tests first, confirm they fail, then make the change that fixes them (`npm test` in the extension dir).
3. **PR.** Open a pull request.
4. **Adversarial review loop.** Review, fix findings, push to the PR, review only the new changes, fix, push. Repeat until clean. Use the cost-efficient review mode, scoped to the PR diff or new commits.
5. **Merge.** Merge the PR and remove the worktree.
6. **Update main.** Pull the latest into the main checkout.
7. **Push to Raycast.** Run `npm run dev` once in the extension dir so Raycast picks up the build.
8. **Clean up.** Stop the dev server and any other background processes or temp files.
