- source_spec: `_bmad-output/implementation-artifacts/spec-1-1-scaffold-project-and-deploy-empty-site.md`
  summary: Make sure a `workflow_dispatch` run of `pipeline.yml` from a non-main branch cannot deploy to the live Pages site.
  evidence: Unverified, would be medium. It is settled by checking that the `github-pages` environment's deployment-branch rule allows only `main` after the first deploy. If it does not, add `if: github.ref == 'refs/heads/main'` to the deploy job.
